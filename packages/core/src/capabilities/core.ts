import { z } from "zod";
import type * as s from "@lictory/core/db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { DeliveryProviders } from "@lictory/core/delivery/registry";
import type { ObjectStorage } from "@lictory/core/storage/s3";

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
// Personal credentials and secrets stay with the signed-in person.
export const webOnly: readonly Surface[] = ["web"];

export type Principal = {
  userId: string;
  surface: Surface;
  // Personal access token used by an MCP client.
  tokenId?: string | null;
  // Read tokens may only invoke queries.
  access?: "read" | "write";
  // Client name reported by the agent, for the audit trail.
  client?: string | null;
};

// Process-level side effects owned by the hosting runtime (Next.js routes,
// tests, workers). Capabilities report what happened; the host decides how
// analytics are sent and background work is scheduled.
export type Effects = {
  track(
    event: string,
    properties?: Record<string, string | number | boolean | null | string[]>,
    deduplicationKey?: string,
  ): void;
  trackFailure(operation: string, error: unknown): void;
  // Notifications may have been queued; deliver pending email.
  notificationsQueued(): void;
  // Lictory Intelligence runs may have been queued; process them after the
  // response.
  aiRunsQueued(): void;
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
  notificationsQueued: () => undefined,
  aiRunsQueued: () => undefined,
};

export type CapabilityContext = {
  db: Database;
  principal: Principal;
  effects: Effects;
  // Object storage for attachments; absent when the host has none configured.
  storage?: () => ObjectStorage;
  // Delivery adapters; defaults to the configured providers.
  deliveryProviders?: DeliveryProviders;
};

export const errorCategories = [
  "unauthorized",
  "forbidden",
  "unavailable",
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
