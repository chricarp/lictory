import { z } from "zod";
import type * as s from "@lictory/core/db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { DeliveryProviders } from "@lictory/core/delivery/registry";
import type { ObjectStorage } from "@lictory/core/storage/s3";
import type { ProposalDrafter } from "@lictory/core/ai/intake";

// The shared application layer.
//
// A capability is one business operation a person can perform, defined once:
// a name, a description written for both people and agents, a validated input
// schema, and a `run` that calls the domain services. The web UI, the MCP
// server and the embedded Lictory agent all invoke capabilities through
// `invoke` (registry.ts), so they share validation, authorization, error
// semantics and side effects. Capabilities never trust identifiers from the
// caller: the principal comes from authentication and the domain services
// re-check organization membership and roles inside their transactions.

export type Database = PostgresJsDatabase<typeof s>;

// Where a call came from. `web` is the signed-in browser; `mcp` an external
// agent holding a personal access token; `agent` the embedded Lictory agent
// acting for the signed-in user.
export const surfaces = ["web", "mcp", "agent"] as const;
export type Surface = (typeof surfaces)[number];
export const everywhere: readonly Surface[] = surfaces;
// Personal credentials and secrets stay with the signed-in person. A web-only
// capability must say why (`humanOnly`) so agents can explain the boundary.
export const webOnly: readonly Surface[] = ["web"];

// Why an operation stays with the person in the browser. Agents read these
// through listHumanOnlyOperations; see human-only.ts.
export const humanOnlyReasons = {
  credentials:
    "Credentials and secrets never pass through an agent's transcript, and agents cannot mint credentials for themselves.",
  account:
    "Account identity and security (sign-in, password, email, sessions, connected accounts, handle, profile) belong to the signed-in person.",
  membership:
    "People decide who belongs to an organization and who administers it.",
  conversation:
    "Litto conversations are managed in the chat where they happen; external agents keep their own conversation.",
  browser:
    "Browser state rather than a business operation; agents have their own way to read the same facts.",
  audit:
    "The audit log is reviewed by organization administrators themselves; agents acting for a person do not read or export security records.",
  export:
    "Taking a copy of all of an organization's data is an administrator's own decision; agents do not start or download organization exports.",
} as const;
export type HumanOnlyReason = keyof typeof humanOnlyReasons;

export type HumanOnly = {
  reason: HumanOnlyReason;
  // Where the person does it, in the browser's words.
  where: string;
  // What an agent can call instead, when something comparable exists.
  alternative?: string;
};

export type Principal = {
  userId: string;
  surface: Surface;
  // Personal access token used by an MCP client.
  tokenId?: string | null;
  // Read tokens may only invoke queries.
  access?: "read" | "write";
  // Client name reported by the agent, for the audit trail.
  client?: string | null;
  // The agent's name: the access token's name for MCP, Litto for the
  // embedded agent. Each token is one named agent acting for its person.
  agentName?: string | null;
};

// Process-level side effects owned by the hosting runtime (API, tests,
// worker). Capabilities report what happened; the host decides how analytics
// are sent. Background work (AI runs, email, exports) is queued durably in the
// domain transaction and processed by the worker.
export type Effects = {
  track(
    event: string,
    properties?: Record<string, string | number | boolean | null | string[]>,
    deduplicationKey?: string,
  ): void;
  trackFailure(operation: string, error: unknown): void;
  publicationCompleted?(publication: {
    id: string;
    organizationId: string;
    requestedById: string;
    status: string;
    results: Record<string, { outcome: string }>;
  }): void;
};

export const noEffects: Effects = {
  track: () => undefined,
  trackFailure: () => undefined,
};

export type CapabilityContext = {
  db: Database;
  principal: Principal;
  effects: Effects;
  // Object storage for attachments; absent when the host has none configured.
  storage?: () => ObjectStorage;
  // Delivery adapters; defaults to the configured providers.
  deliveryProviders?: DeliveryProviders;
  // Lictory Intelligence adapter for proposal intake; defaults to the
  // configured provider. Tests substitute their own.
  proposalDrafter?: ProposalDrafter;
};

export const errorCategories = [
  "unauthorized",
  "forbidden",
  "unavailable",
  "not_found",
  "validation",
  "conflict",
  "external",
  "server",
] as const;
export type ErrorCategory = (typeof errorCategories)[number];

// The one error shape every surface reports. Messages are written for the
// person (or agent) who can act on them.
export class CapabilityError extends Error {
  constructor(
    readonly category: ErrorCategory,
    message: string,
    readonly details: {
      currentRevisionId?: string;
      issues?: { path: string; message: string }[];
      kind?: string;
      retryable?: boolean;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "CapabilityError";
  }
  toJSON() {
    const details = { ...this.details };
    delete details.status;
    return { category: this.category, message: this.message, ...details };
  }
}

export function httpStatus(error: CapabilityError) {
  if (error.details.status) return error.details.status;
  switch (error.category) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "unavailable":
    case "not_found":
      return 404;
    case "validation":
      return 422;
    case "conflict":
      return 409;
    case "external":
      return error.details.retryable ? 503 : 422;
    case "server":
      return 500;
  }
}

// Kind of operation. Queries never change state; commands may.
export type CapabilityKind = "query" | "command";

export type Capability<I extends z.ZodType = z.ZodType, O = unknown> = {
  name: string;
  title: string;
  description: string;
  kind: CapabilityKind;
  // Surfaces allowed to invoke it. Token and credential management, for
  // example, stays with the signed-in person.
  surfaces: readonly Surface[];
  input: I;
  // Hints for agents (MCP tool annotations).
  destructive?: boolean;
  idempotent?: boolean;
  // Talks to systems outside Lictory (Jira, object storage).
  external?: boolean;
  // Records a human decision (approve, merge, resolve, export). Agents may
  // only invoke it when the person explicitly asked; the embedded agent asks
  // for confirmation first.
  decision?: boolean;
  // Required when an agent surface (mcp, agent) is excluded: why the operation
  // stays with the person and where they do it.
  humanOnly?: HumanOnly;
  run(ctx: CapabilityContext, input: z.output<I>): Promise<O>;
};

export function defineCapability<I extends z.ZodType, O>(
  capability: Capability<I, O>,
): Capability<I, O> {
  return capability;
}

export type AnyCapability = Capability<z.ZodType, unknown>;

export const id = z.string().min(1).max(160);
export const organizationId = id.describe(
  "Organization id (see listOrganizations).",
);
