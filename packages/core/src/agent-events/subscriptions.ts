import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { agentEventSubscription as machine } from "@lictory/core/contracts/state-machines";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import {
  decryptCredential,
  derivedCredentialsKeyInProduction,
  encryptCredential,
} from "@lictory/core/delivery/credentials";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import {
  authorize,
  lock,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import type { AgentScope } from "@lictory/core/factory/authority";
import {
  allowPrivateNetworksFromEnv,
  checkDestinationUrl,
  EgressError,
  egressRequest,
  type EgressPolicy,
  type Resolver,
} from "@lictory/core/lib/egress";
import {
  agentEventTypeList,
  isAgentEventType,
  type AgentEventType,
} from "@lictory/core/agent-events/catalog";
import {
  AGENT_EVENT_RETENTION_MS,
  decodeCursor,
  encodeCursor,
  latestCursor,
  type Cursor,
} from "@lictory/core/agent-events/feed";
import {
  bearerHeaders,
  signingKey,
  webhookHeaders,
} from "@lictory/core/agent-events/signing";

// Where a person's agent events go (docs/internals/agent-events.md):
// webhooks people register in Account settings, and MCP Events webhook
// subscriptions MCP clients create. Both are delivered by the worker
// (agent-events/delivery.ts); this module creates, renews, pauses and
// removes them, and holds the organization policy that decides whether an
// organization's events may leave Lictory at all.

type Row = typeof s.agentEventSubscription.$inferSelect;

const MAX_WEBHOOKS = 20;
const MAX_MCP_SUBSCRIPTIONS = 100;
// MCP leases: what the client suggests, within these bounds.
const DEFAULT_TTL_MS = 60 * 60_000;
const MIN_TTL_MS = 5 * 60_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
// A verified (token, URL) pair is not challenged again for this long.
const VERIFICATION_CACHE_MS = 24 * 60 * 60_000;
// A rotated MCP secret still signs deliveries this long.
const ROTATION_GRACE_MS = 60 * 60_000;
const VERIFICATION_TIMEOUT_MS = 10_000;

function egressPolicy(): EgressPolicy {
  return { allowPrivateNetworks: allowPrivateNetworksFromEnv() };
}

// ----------------------------------------------------- organization policy

export type AgentEventPolicy = {
  organizationId: string;
  webhooksAllowed: boolean;
  allowedHosts: string[] | null;
  version: number;
  updatedAt: string | null;
};

export async function agentEventPolicyOf(
  db: Database | Tx,
  organizationId: string,
): Promise<AgentEventPolicy> {
  const [row] = await db
    .select()
    .from(s.agentEventPolicy)
    .where(eq(s.agentEventPolicy.organizationId, organizationId));
  return {
    organizationId,
    webhooksAllowed: row?.webhooksAllowed ?? true,
    allowedHosts: row?.allowedHosts ?? null,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

const HOST =
  /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeHosts(hosts: readonly string[]) {
  const normalized = [
    ...new Set(hosts.map((h) => h.trim().toLowerCase()).filter(Boolean)),
  ];
  for (const host of normalized)
    if (!HOST.test(host) && !/^[0-9a-f:.]+$/.test(host))
      throw new DomainError(
        "validation",
        `“${host}” is not a host name. Enter names like hooks.example.com or *.example.com.`,
      );
  if (normalized.length > 50)
    throw new DomainError("validation", "List at most 50 hosts.");
  return normalized;
}

// The policy admits this destination host.
export function hostAllowed(
  policy: Pick<AgentEventPolicy, "webhooksAllowed" | "allowedHosts">,
  hostname: string,
) {
  if (!policy.webhooksAllowed) return false;
  if (!policy.allowedHosts) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return policy.allowedHosts.some((entry) =>
    entry.startsWith("*.") ? host.endsWith(entry.slice(1)) : host === entry,
  );
}

function policyRefusal(organizationName: string, policy: AgentEventPolicy) {
  return new DomainError(
    "forbidden",
    policy.webhooksAllowed
      ? `${organizationName} only allows webhooks to ${policy.allowedHosts?.join(", ")}. An administrator can change this in Organization settings → Security.`
      : `${organizationName} does not allow its events to be sent to webhooks. An administrator can change this in Organization settings → Security.`,
    undefined,
    "webhook_policy",
  );
}

export async function setAgentEventPolicy(
  db: Database,
  userId: string,
  input: {
    organizationId: string;
    webhooksAllowed: boolean;
    allowedHosts: string[] | null;
    expectedVersion?: number;
  },
) {
  const allowedHosts = input.allowedHosts
    ? normalizeHosts(input.allowedHosts)
    : null;
  return db.transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const member = await authorize(tx, userId, input.organizationId);
    if (applicationRoleOf(member.role) !== "admin")
      throw new DomainError(
        "forbidden",
        "Only organization administrators decide where the organization's events may be sent.",
      );
    const current = await agentEventPolicyOf(tx, input.organizationId);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version
    )
      throw new DomainError(
        "conflict",
        "The webhook policy changed since you opened it. Review the current policy before saving.",
      );
    const values = {
      webhooksAllowed: input.webhooksAllowed,
      allowedHosts: allowedHosts?.length ? allowedHosts : null,
      version: current.version + 1,
      updatedById: userId,
      updatedAt: new Date(),
    };
    await tx
      .insert(s.agentEventPolicy)
      .values({ organizationId: input.organizationId, ...values })
      .onConflictDoUpdate({
        target: s.agentEventPolicy.organizationId,
        set: values,
      });
    await tx.insert(s.configurationAudit).values({
      organizationId: input.organizationId,
      actorId: userId,
      action: "setAgentEventPolicy",
      detail: {
        command: {
          type: "setAgentEventPolicy",
          webhooksAllowed: values.webhooksAllowed,
          allowedHosts: values.allowedHosts,
        },
        previous: {
          webhooksAllowed: current.webhooksAllowed,
          allowedHosts: current.allowedHosts,
          version: current.version,
        },
      },
    });
    return agentEventPolicyOf(tx, input.organizationId);
  });
}

// ----------------------------------------------------- secrets

const aad = (id: string) => `agent-event-subscription:${id}`;
const sealSecret = (id: string, secret: string) =>
  encryptCredential(aad(id), secret);
export const openSecret = (row: Pick<Row, "id" | "secret">) =>
  decryptCredential<string>(aad(row.id), row.secret);

// Production without DELIVERY_CREDENTIALS_KEY: secrets would depend on
// BETTER_AUTH_SECRET, so none are stored unless some already were.
async function assertCanStoreSecrets(tx: Tx) {
  if (!derivedCredentialsKeyInProduction(process.env)) return;
  const [stored] = await tx
    .select({ id: s.agentEventSubscription.id })
    .from(s.agentEventSubscription)
    .limit(1);
  if (!stored)
    throw new DomainError(
      "unavailable",
      "Webhooks cannot be stored yet: this Lictory installation has no DELIVERY_CREDENTIALS_KEY. An operator must set it and restart Lictory (see docs/operations/configuration.md).",
    );
}

// ----------------------------------------------------- views

export type SubscriptionView = {
  id: string;
  kind: "webhook" | "mcp";
  name: string;
  url: string;
  organizationId: string | null;
  agentId: string | null;
  // The bound agent, when listed (Account settings links to its page).
  agent?: { name: string; organizationId: string } | null;
  accessTokenId: string | null;
  eventTypes: AgentEventType[];
  projectIds: string[] | null;
  status: Row["status"];
  statusReason: string | null;
  refreshBefore: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorDetail: string | null;
  failedSince: string | null;
  // While an active destination fails: attempts at the event it is stuck
  // on, and when the next one is due.
  retry: { failedAttempts: number; nextAttemptAt: string } | null;
  deliveredCount: number;
  // Events waiting after the cursor (at most 100 counted).
  pending: number;
  createdAt: string;
  steps: string[];
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

function viewOf(row: Row, pending: number): SubscriptionView {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    organizationId: row.organizationId,
    agentId: row.agentId,
    accessTokenId: row.accessTokenId,
    eventTypes: row.eventTypes.filter(isAgentEventType),
    projectIds: row.projectIds,
    status: row.status,
    statusReason: row.statusReason,
    refreshBefore: iso(row.refreshBefore),
    lastAttemptAt: iso(row.lastAttemptAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastError: row.lastError,
    lastErrorDetail: row.lastErrorDetail,
    failedSince: iso(row.failedSince),
    // Still delivering (failures can still suspend it), and failing.
    retry:
      machine.allows(row.status, "suspend") && row.attempts > 0
        ? {
            failedAttempts: row.attempts,
            nextAttemptAt: row.nextAttemptAt.toISOString(),
          }
        : null,
    deliveredCount: row.deliveredCount,
    pending,
    createdAt: row.createdAt.toISOString(),
    steps: machine.available(row.status),
  };
}

async function pendingCount(db: Database | Tx, row: Row) {
  const [result] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select 1 from ${s.agentEvent} e
      where e.user_id = ${row.userId}
        and e.seq > ${row.cursorSeq}
        ${row.organizationId ? sql`and e.organization_id = ${row.organizationId}` : sql``}
        ${
          row.eventTypes.length
            ? sql`and e.type in (${sql.join(
                row.eventTypes.map((t) => sql`${t}`),
                sql`, `,
              )})`
            : sql``
        }
      limit 101) pending`);
  return Number(result?.n ?? 0);
}

export async function listSubscriptions(db: Database, userId: string) {
  const rows = await db
    .select({
      row: s.agentEventSubscription,
      agentName: s.agent.name,
      agentOrganizationId: s.agent.organizationId,
    })
    .from(s.agentEventSubscription)
    .leftJoin(s.agent, eq(s.agent.id, s.agentEventSubscription.agentId))
    .where(eq(s.agentEventSubscription.userId, userId))
    .orderBy(desc(s.agentEventSubscription.createdAt));
  const views: SubscriptionView[] = [];
  for (const { row, agentName, agentOrganizationId } of rows)
    views.push({
      ...viewOf(row, await pendingCount(db, row)),
      agent:
        row.agentId && agentName && agentOrganizationId
          ? { name: agentName, organizationId: agentOrganizationId }
          : null,
    });
  return views;
}

async function ownRow(tx: Database | Tx, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(s.agentEventSubscription)
    .where(
      and(
        eq(s.agentEventSubscription.id, id),
        eq(s.agentEventSubscription.userId, userId),
      ),
    );
  if (!row)
    throw new DomainError(
      "not_found",
      "This webhook or subscription no longer exists.",
    );
  return row;
}

// ----------------------------------------------------- agents

// The scope a subscription bound to a Factory agent delivers within, or
// null when the agent no longer acts for this person.
export async function agentScopeOf(
  db: Database | Tx,
  agentId: string,
  userId: string,
): Promise<AgentScope | null> {
  const [agent] = await db
    .select()
    .from(s.agent)
    .where(eq(s.agent.id, agentId));
  if (!agent || agent.archivedAt || agent.ownerId !== userId) return null;
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    name: agent.name,
    handle: agent.handle,
    access: agent.access === "read" ? "read" : "write",
    projectIds: agent.projectIds ?? null,
    sessionId: null,
  };
}

// ----------------------------------------------------- webhooks (people)

type WebhookInput = {
  name: string;
  url: string;
  secret: string;
  organizationId: string | null;
  agentId?: string | null;
  eventTypes: string[];
  projectIds?: string[] | null;
};

function validTypes(types: readonly string[]) {
  const unknown = types.filter((t) => !isAgentEventType(t));
  if (unknown.length)
    throw new DomainError(
      "validation",
      `Unknown event type: ${unknown.join(", ")}. Known types: ${agentEventTypeList.join(", ")}.`,
    );
  return [...new Set(types)] as AgentEventType[];
}

function destination(url: string) {
  try {
    return checkDestinationUrl(url, egressPolicy());
  } catch (error) {
    if (error instanceof EgressError)
      throw new DomainError(
        "validation",
        error.message,
        undefined,
        error.reason,
      );
    throw error;
  }
}

// Organizations this destination may receive events from: the one named,
// or every membership (then at least one must allow it).
async function checkOrganizations(
  tx: Tx,
  userId: string,
  organizationId: string | null,
  url: URL,
) {
  const memberships = await tx
    .select({ id: s.organization.id, name: s.organization.name })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .where(
      and(
        eq(s.member.userId, userId),
        ...(organizationId
          ? [eq(s.member.organizationId, organizationId)]
          : []),
      ),
    );
  if (organizationId && !memberships.length)
    throw new DomainError(
      "not_found",
      "Organization not found among your memberships.",
    );
  const refusals: DomainError[] = [];
  for (const m of memberships) {
    const policy = await agentEventPolicyOf(tx, m.id);
    if (!hostAllowed(policy, url.hostname))
      refusals.push(policyRefusal(m.name, policy));
  }
  if (refusals.length && refusals.length === memberships.length)
    throw refusals[0]!;
}

export async function createWebhook(
  db: Database,
  userId: string,
  input: WebhookInput,
) {
  const name = input.name.trim();
  if (!name || name.length > 80)
    throw new DomainError(
      "validation",
      "Name the webhook (at most 80 characters).",
    );
  const secret = input.secret.trim();
  if (!secret || secret.length > 4096)
    throw new DomainError(
      "validation",
      "Paste the receiver's bearer secret (at most 4096 characters).",
    );
  const url = destination(input.url);
  const eventTypes = validTypes(input.eventTypes);
  return db.transaction(async (tx) => {
    let organizationId = input.organizationId;
    if (input.agentId) {
      const agent = await agentScopeOf(tx, input.agentId, userId);
      if (!agent)
        throw new DomainError("not_found", "That agent is not one of yours.");
      if (organizationId && organizationId !== agent.organizationId)
        throw new DomainError(
          "validation",
          "The agent belongs to another organization.",
        );
      organizationId = agent.organizationId;
    }
    if (organizationId) await authorize(tx, userId, organizationId);
    await checkOrganizations(tx, userId, organizationId, url);
    await assertCanStoreSecrets(tx);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(s.agentEventSubscription)
      .where(
        and(
          eq(s.agentEventSubscription.userId, userId),
          eq(s.agentEventSubscription.kind, "webhook"),
        ),
      );
    if ((count?.n ?? 0) >= MAX_WEBHOOKS)
      throw new DomainError(
        "validation",
        `You can have at most ${MAX_WEBHOOKS} webhooks. Remove one you no longer use.`,
      );
    const id = `whk_${randomBytes(12).toString("base64url")}`;
    const start = await latestCursor(tx, userId);
    const [row] = await tx
      .insert(s.agentEventSubscription)
      .values({
        id,
        kind: "webhook",
        userId,
        organizationId,
        agentId: input.agentId ?? null,
        name,
        url: url.href,
        secret: sealSecret(id, secret),
        eventTypes,
        projectIds: input.projectIds?.length ? input.projectIds : null,
        status: "active",
        cursorSeq: start.seq,
      })
      .returning();
    await auditDestination(tx, userId, row!, "event_webhook.created");
    return viewOf(row!, 0);
  });
}

async function auditDestination(
  tx: Tx,
  userId: string,
  row: Row,
  action:
    | "event_webhook.created"
    | "event_webhook.deleted"
    | "event_subscription.created"
    | "event_subscription.deleted",
) {
  const organizations = row.organizationId
    ? [row.organizationId]
    : (
        await tx
          .select({ id: s.member.organizationId })
          .from(s.member)
          .where(eq(s.member.userId, userId))
      ).map((m) => m.id);
  for (const organizationId of organizations)
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action,
      target: { type: "event_subscription", id: row.id, label: row.name },
      detail: {
        kind: row.kind,
        host: new URL(row.url).host,
        eventTypes: row.eventTypes,
      },
    });
}

export async function updateWebhook(
  db: Database,
  userId: string,
  id: string,
  input: { name?: string; eventTypes?: string[]; secret?: string },
) {
  return db.transaction(async (tx) => {
    const row = await ownRow(tx, userId, id);
    const values: Partial<typeof s.agentEventSubscription.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 80)
        throw new DomainError(
          "validation",
          "Name the webhook (at most 80 characters).",
        );
      values.name = name;
    }
    if (input.eventTypes) {
      if (row.kind === "mcp")
        throw new DomainError(
          "validation",
          "An MCP subscription's event type is chosen by its client.",
        );
      values.eventTypes = validTypes(input.eventTypes);
    }
    if (input.secret !== undefined) {
      if (row.kind === "mcp")
        throw new DomainError(
          "validation",
          "An MCP subscription's signing secret belongs to its client.",
        );
      const secret = input.secret.trim();
      if (!secret || secret.length > 4096)
        throw new DomainError(
          "validation",
          "Paste the receiver's bearer secret.",
        );
      values.secret = sealSecret(row.id, secret);
    }
    const [updated] = await tx
      .update(s.agentEventSubscription)
      .set(values)
      .where(eq(s.agentEventSubscription.id, row.id))
      .returning();
    return viewOf(updated!, await pendingCount(tx, updated!));
  });
}

// Pause or resume (people's steps of the declared machine). Resuming
// retries the event at the cursor at once.
export async function setSubscriptionState(
  db: Database,
  userId: string,
  id: string,
  step: "pause" | "resume",
) {
  return db.transaction(async (tx) => {
    const row = await ownRow(tx, userId, id);
    requireStep(machine, row.status, step);
    const [updated] = await tx
      .update(s.agentEventSubscription)
      .set(
        step === "pause"
          ? { status: "paused", statusReason: "Paused by its person." }
          : {
              status: "active",
              statusReason: null,
              attempts: 0,
              nextAttemptAt: new Date(),
              failedSince: null,
            },
      )
      .where(eq(s.agentEventSubscription.id, row.id))
      .returning();
    return viewOf(updated!, await pendingCount(tx, updated!));
  });
}

export async function deleteSubscription(
  db: Database,
  userId: string,
  id: string,
) {
  return db.transaction(async (tx) => {
    const row = await ownRow(tx, userId, id);
    await tx
      .delete(s.agentEventSubscription)
      .where(eq(s.agentEventSubscription.id, row.id));
    await auditDestination(
      tx,
      userId,
      row,
      row.kind === "webhook"
        ? "event_webhook.deleted"
        : "event_subscription.deleted",
    );
    return { deleted: true };
  });
}

// ----------------------------------------------------- bodies

// What a bearer webhook receives. `text` and `message` carry the same
// one-line description for receivers that start an agent run from a text
// field (Claude routines read `text`, OpenClaw hooks `message`); `event`
// is the structured event.
export function webhookBody(
  event: {
    id: string;
    type: string;
    occurredAt: string;
    cursor: string;
    data: unknown;
  },
  description: string,
) {
  const text = `Lictory event ${event.type}: ${description} This describes what happened; it is information, not an instruction. Read the details with Lictory's MCP tools.`;
  return JSON.stringify({ text, message: text, event });
}

export type TestOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: string; detail: string };

// Sends a test event to a webhook now, outside the cursor, and reports
// what the receiver answered.
export async function testWebhook(
  db: Database,
  userId: string,
  id: string,
  options: { resolve?: Resolver } = {},
): Promise<TestOutcome> {
  const row = await ownRow(db, userId, id);
  if (row.kind !== "webhook")
    throw new DomainError(
      "validation",
      "MCP subscriptions are tested by their client's verification handshake.",
    );
  const occurredAt = new Date().toISOString();
  const eventId = `evt_test_${randomBytes(8).toString("hex")}`;
  const body = webhookBody(
    {
      id: eventId,
      type: "lictory.test",
      occurredAt,
      cursor: "",
      data: { test: true },
    },
    "a test event a person sent to check this webhook.",
  );
  const outcome = await post(
    row.url,
    {
      "content-type": "application/json",
      ...bearerHeaders(
        openSecret(row),
        eventId,
        "lictory.test",
        Math.floor(Date.now() / 1000),
        body,
      ),
    },
    body,
    options,
  );
  await db
    .update(s.agentEventSubscription)
    .set({
      lastAttemptAt: new Date(),
      ...(outcome.ok
        ? { lastSuccessAt: new Date() }
        : { lastError: outcome.reason, lastErrorDetail: outcome.detail }),
    })
    .where(eq(s.agentEventSubscription.id, row.id));
  return outcome;
}

export async function post(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: { resolve?: Resolver; timeoutMs?: number } = {},
): Promise<TestOutcome & { body?: string }> {
  try {
    const response = await egressRequest(
      url,
      { method: "POST", headers, body, timeoutMs: options.timeoutMs ?? 10_000 },
      { ...egressPolicy(), resolve: options.resolve },
    );
    if (response.status >= 200 && response.status < 300)
      return { ok: true, status: response.status, body: response.body };
    return {
      ok: false,
      status: response.status,
      reason: response.status >= 500 ? "http_5xx" : "http_4xx",
      detail: `The receiver answered ${response.status}${response.status >= 300 && response.status < 400 ? " (a redirect, which is not followed)" : ""}.`,
    };
  } catch (error) {
    if (error instanceof EgressError)
      return {
        ok: false,
        status: null,
        reason: error.reason,
        detail: error.message,
      };
    return {
      ok: false,
      status: null,
      reason: "network",
      detail:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "Request failed.",
    };
  }
}

// ----------------------------------------------------- MCP subscriptions

// Errors of the MCP Events extension, mapped to its JSON-RPC codes by the
// MCP adapter.
export class EventsProtocolError extends Error {
  constructor(
    readonly kind:
      | "invalid_params"
      | "not_found"
      | "forbidden"
      | "resource_exhausted"
      | "unsupported"
      | "callback_endpoint",
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventsProtocolError";
  }
}

type McpPrincipal = {
  userId: string;
  tokenId: string;
  agent: AgentScope | null;
};

// The arguments of every event (MCP `inputSchema`): which organization and
// projects to follow.
export const subscriptionArgumentsSchema = {
  type: "object",
  properties: {
    organizationId: {
      type: "string",
      description:
        "Only events of this organization (an id or slug from listOrganizations). Omit for every organization you belong to.",
    },
    projectIds: {
      type: "array",
      items: { type: "string" },
      description: "Only events of these projects.",
    },
  },
  additionalProperties: false,
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

// Stable for (principal, url, name, arguments): subscribing again with the
// same key refreshes the same subscription.
export function subscriptionId(
  tokenId: string,
  url: string,
  name: string,
  args: Record<string, unknown>,
) {
  const digest = createHash("sha256")
    .update(`${tokenId}\n${url}\n${name}\n${canonical(args)}`)
    .digest("base64url");
  return `sub_${digest.slice(0, 24)}`;
}

function parseArguments(raw: unknown) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new EventsProtocolError(
      "invalid_params",
      "arguments must be an object.",
    );
  const args = raw as Record<string, unknown>;
  for (const key of Object.keys(args))
    if (key !== "organizationId" && key !== "projectIds")
      throw new EventsProtocolError(
        "invalid_params",
        `Unknown argument: ${key}.`,
      );
  if (
    args.organizationId !== undefined &&
    typeof args.organizationId !== "string"
  )
    throw new EventsProtocolError(
      "invalid_params",
      "organizationId must be a string.",
    );
  if (
    args.projectIds !== undefined &&
    (!Array.isArray(args.projectIds) ||
      !args.projectIds.every((p) => typeof p === "string") ||
      args.projectIds.length > 50)
  )
    throw new EventsProtocolError(
      "invalid_params",
      "projectIds must be a list of project ids.",
    );
  return {
    ...(args.organizationId ? { organizationId: args.organizationId } : {}),
    ...(args.projectIds ? { projectIds: [...args.projectIds].sort() } : {}),
  };
}

async function resolveOrganization(
  db: Database,
  principal: McpPrincipal,
  reference: string | undefined,
) {
  if (principal.agent) {
    if (reference && reference !== principal.agent.organizationId) {
      const [org] = await db
        .select({ id: s.organization.id })
        .from(s.organization)
        .where(eq(s.organization.slug, reference));
      if (org?.id !== principal.agent.organizationId)
        throw new EventsProtocolError(
          "forbidden",
          `${principal.agent.name} acts only in its own organization.`,
        );
    }
    return principal.agent.organizationId;
  }
  if (!reference) return null;
  const rows = await db
    .select({ id: s.organization.id })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .where(
      and(
        eq(s.member.userId, principal.userId),
        or(
          eq(s.organization.id, reference),
          eq(s.organization.slug, reference),
        ),
      ),
    );
  if (rows.length !== 1)
    throw new EventsProtocolError(
      "not_found",
      "Organization not found among your memberships. Use an id or slug from listOrganizations.",
      { kind: "organization" },
    );
  return rows[0]!.id;
}

function grantTtl(ttlMs: unknown) {
  if (ttlMs === null) return MAX_TTL_MS;
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs))
    return DEFAULT_TTL_MS;
  return Math.min(Math.max(ttlMs, MIN_TTL_MS), MAX_TTL_MS);
}

type SubscribeParams = {
  name?: unknown;
  arguments?: unknown;
  delivery?: unknown;
  cursor?: unknown;
  maxAgeMs?: unknown;
  ttlMs?: unknown;
};

// The verification handshake (MCP Events, webhook mode): a signed control
// envelope with a single-use challenge the endpoint must echo in a 2xx
// body. Answered inside `events/subscribe`.
async function verifyCallback(
  url: string,
  subscriptionId: string,
  secret: string,
  options: { resolve?: Resolver },
) {
  const challenge = randomBytes(24).toString("base64url");
  const body = JSON.stringify({ type: "verification", challenge });
  const id = `msg_verification_${randomBytes(12).toString("hex")}`;
  const outcome = await post(
    url,
    {
      "content-type": "application/json",
      ...webhookHeaders([secret], id, Math.floor(Date.now() / 1000), body),
      "x-mcp-subscription-id": subscriptionId,
    },
    body,
    { resolve: options.resolve, timeoutMs: VERIFICATION_TIMEOUT_MS },
  );
  const fail = (reason: string, detail: string) =>
    new EventsProtocolError(
      "callback_endpoint",
      `Callback verification failed: ${detail}`,
      {
        reason,
      },
    );
  if (!outcome.ok) {
    const reason =
      outcome.reason === "timeout" ||
      outcome.reason === "connection_refused" ||
      outcome.reason === "tls_error"
        ? outcome.reason
        : "challenge_failed";
    throw fail(reason, outcome.detail);
  }
  let echoed: unknown;
  try {
    echoed = (JSON.parse(outcome.body ?? "") as { challenge?: unknown })
      .challenge;
  } catch {
    echoed = undefined;
  }
  const given = Buffer.from(typeof echoed === "string" ? echoed : "");
  const expected = Buffer.from(challenge);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw fail("challenge_failed", "the endpoint did not echo the challenge.");
}

export async function subscribeMcp(
  db: Database,
  principal: McpPrincipal,
  params: SubscribeParams,
  options: { now?: Date; resolve?: Resolver } = {},
) {
  const now = options.now ?? new Date();
  const name = params.name;
  if (typeof name !== "string" || !isAgentEventType(name))
    throw new EventsProtocolError(
      "invalid_params",
      `Unknown event: ${String(name)}. See events/list.`,
    );
  const delivery = params.delivery as
    { mode?: unknown; url?: unknown; secret?: unknown } | undefined;
  if (!delivery || typeof delivery !== "object")
    throw new EventsProtocolError("invalid_params", "delivery is required.");
  if (delivery.mode !== "webhook")
    throw new EventsProtocolError(
      "unsupported",
      "Only webhook delivery is supported. Agents without a webhook can call waitForEvents instead.",
      { mode: delivery.mode ?? null },
    );
  if (typeof delivery.url !== "string")
    throw new EventsProtocolError(
      "invalid_params",
      "delivery.url is required.",
    );
  if (typeof delivery.secret !== "string" || !signingKey(delivery.secret))
    throw new EventsProtocolError(
      "invalid_params",
      "delivery.secret must be a whsec_ secret whose base64 value decodes to 24–64 bytes.",
    );
  let url: URL;
  try {
    url = checkDestinationUrl(delivery.url, egressPolicy());
  } catch (error) {
    throw new EventsProtocolError(
      "invalid_params",
      error instanceof Error ? error.message : "Invalid callback URL.",
    );
  }
  if (url.protocol !== "https:" && !egressPolicy().allowPrivateNetworks)
    throw new EventsProtocolError("invalid_params", "Callback URLs use https.");
  const args = parseArguments(params.arguments);
  const organizationId = await resolveOrganization(
    db,
    principal,
    args.organizationId,
  );
  const maxAgeMs =
    typeof params.maxAgeMs === "number" && params.maxAgeMs > 0
      ? Math.min(Math.round(params.maxAgeMs), AGENT_EVENT_RETENTION_MS)
      : null;
  let cursor: Cursor | null = null;
  if (typeof params.cursor === "string" && params.cursor) {
    try {
      cursor = decodeCursor(params.cursor);
    } catch {
      throw new EventsProtocolError(
        "invalid_params",
        "Unknown cursor: use one this server returned.",
      );
    }
  }
  const id = subscriptionId(principal.tokenId, url.href, name, args);
  const refreshBefore = new Date(now.getTime() + grantTtl(params.ttlMs));

  // Policy and limits first, under no lock (reads only).
  try {
    await db.transaction((tx) =>
      checkOrganizations(tx, principal.userId, organizationId, url),
    );
  } catch (error) {
    if (error instanceof DomainError)
      throw new EventsProtocolError(
        error.category === "not_found" ? "not_found" : "forbidden",
        error.message,
      );
    throw error;
  }
  const [existing] = await db
    .select()
    .from(s.agentEventSubscription)
    .where(eq(s.agentEventSubscription.id, id));
  if (!existing) {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.agentEventSubscription)
      .where(eq(s.agentEventSubscription.accessTokenId, principal.tokenId));
    if ((count?.n ?? 0) >= MAX_MCP_SUBSCRIPTIONS)
      throw new EventsProtocolError(
        "resource_exhausted",
        `An access token can hold at most ${MAX_MCP_SUBSCRIPTIONS} event subscriptions. Unsubscribe from some first.`,
      );
  }
  // Verification: once per (token, URL) within the cache period, outside
  // any transaction (it is a network call).
  const [verified] = await db
    .select({ id: s.agentEventSubscription.id })
    .from(s.agentEventSubscription)
    .where(
      and(
        eq(s.agentEventSubscription.accessTokenId, principal.tokenId),
        eq(s.agentEventSubscription.url, url.href),
        sql`${s.agentEventSubscription.verifiedAt} > ${new Date(now.getTime() - VERIFICATION_CACHE_MS).toISOString()}::timestamp`,
      ),
    )
    .limit(1);
  if (!verified) await verifyCallback(url.href, id, delivery.secret, options);
  const verifiedAt = verified ? undefined : now;

  const row = await db.transaction(async (tx) => {
    await assertCanStoreSecrets(tx).catch((error: unknown) => {
      throw new EventsProtocolError(
        "forbidden",
        error instanceof Error ? error.message : "Secrets cannot be stored.",
      );
    });
    const [current] = await tx
      .select()
      .from(s.agentEventSubscription)
      .where(eq(s.agentEventSubscription.id, id))
      .for("update");
    if (!current) {
      const start = cursor ?? (await latestCursor(tx, principal.userId));
      const [created] = await tx
        .insert(s.agentEventSubscription)
        .values({
          id,
          kind: "mcp",
          userId: principal.userId,
          organizationId,
          agentId: principal.agent?.id ?? null,
          accessTokenId: principal.tokenId,
          name,
          url: url.href,
          secret: sealSecret(id, delivery.secret as string),
          eventTypes: [name],
          projectIds: args.projectIds ?? null,
          arguments: args,
          maxAgeMs,
          status: "active",
          cursorSeq: start.seq,
          refreshBefore,
          verifiedAt: verifiedAt ?? now,
        })
        .returning();
      await auditDestination(
        tx,
        principal.userId,
        created!,
        "event_subscription.created",
      );
      return created!;
    }
    // A refresh: same key, so a renewal of the same subscription. A
    // person's pause stands; anything else becomes active again.
    requireStep(machine, current.status, "renew");
    const previous = openSecret(current);
    const rotated = previous !== delivery.secret;
    const [renewed] = await tx
      .update(s.agentEventSubscription)
      .set({
        status: current.status === "paused" ? "paused" : "active",
        statusReason: current.status === "paused" ? current.statusReason : null,
        refreshBefore,
        maxAgeMs,
        secret: sealSecret(id, delivery.secret as string),
        ...(rotated
          ? {
              previousSecret: sealSecret(`${id}:previous`, previous),
              previousUntil: new Date(now.getTime() + ROTATION_GRACE_MS),
            }
          : {}),
        ...(cursor ? { cursorSeq: cursor.seq } : {}),
        ...(current.status !== "active"
          ? { attempts: 0, nextAttemptAt: now, failedSince: null }
          : {}),
        ...(verifiedAt ? { verifiedAt } : {}),
      })
      .where(eq(s.agentEventSubscription.id, id))
      .returning();
    return renewed!;
  });
  return {
    resultType: "complete" as const,
    id: row.id,
    refreshBefore: row.refreshBefore!.toISOString(),
    cursor: encodeCursor({ seq: row.cursorSeq }),
    truncated: false,
    deliveryStatus: {
      active: row.status === "active",
      lastDeliveryAt: iso(row.lastSuccessAt),
      lastError: row.lastError,
      ...(row.failedSince
        ? { failedSince: row.failedSince.toISOString() }
        : {}),
    },
  };
}

// The previous secret of a rotated MCP subscription, while it still signs.
export function previousSecretOf(row: Row, now: Date) {
  if (!row.previousSecret || !row.previousUntil || row.previousUntil <= now)
    return null;
  return decryptCredential<string>(
    aad(`${row.id}:previous`),
    row.previousSecret,
  );
}

export async function unsubscribeMcp(
  db: Database,
  principal: McpPrincipal,
  params: { name?: unknown; arguments?: unknown; delivery?: unknown },
) {
  const name = params.name;
  if (typeof name !== "string")
    throw new EventsProtocolError("invalid_params", "name is required.");
  const url = (params.delivery as { url?: unknown } | undefined)?.url;
  if (typeof url !== "string")
    throw new EventsProtocolError(
      "invalid_params",
      "delivery.url is required.",
    );
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    throw new EventsProtocolError(
      "invalid_params",
      "delivery.url is not a URL.",
    );
  }
  const args = parseArguments(params.arguments);
  const id = subscriptionId(principal.tokenId, href, name, args);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(s.agentEventSubscription)
      .where(
        and(
          eq(s.agentEventSubscription.id, id),
          eq(s.agentEventSubscription.accessTokenId, principal.tokenId),
        ),
      )
      .returning();
    if (!row)
      throw new EventsProtocolError("not_found", "No such subscription.", {
        kind: "subscription",
      });
    await auditDestination(
      tx,
      principal.userId,
      row,
      "event_subscription.deleted",
    );
    return { resultType: "complete" as const };
  });
}

// ----------------------------------------------------- housekeeping

// Expires MCP subscriptions whose lease passed or whose token stopped
// working, and removes ones that expired a week ago.
export async function expireSubscriptions(db: Database, now = new Date()) {
  const expired = await db
    .update(s.agentEventSubscription)
    .set({
      status: "expired",
      statusReason: "Its MCP client did not renew it in time.",
      leaseUntil: null,
    })
    .where(
      and(
        eq(s.agentEventSubscription.kind, "mcp"),
        inArray(
          s.agentEventSubscription.status,
          machine.steps.expire.from as unknown as Row["status"][],
        ),
        lt(s.agentEventSubscription.refreshBefore, now),
      ),
    )
    .returning({ id: s.agentEventSubscription.id });
  const revoked = await db.execute<{ id: string }>(sql`
    update ${s.agentEventSubscription} sub
    set status = 'expired', status_reason = 'Its access token was revoked or expired.', lease_until = null
    from ${s.accessToken} t
    where t.id = sub.access_token_id
      and sub.status <> 'expired'
      and (t.revoked_at is not null or (t.expires_at is not null and t.expires_at <= ${now.toISOString()}::timestamp))
    returning sub.id`);
  const removed = await db
    .delete(s.agentEventSubscription)
    .where(
      and(
        eq(s.agentEventSubscription.status, "expired"),
        eq(s.agentEventSubscription.kind, "mcp"),
        or(
          lt(
            s.agentEventSubscription.refreshBefore,
            new Date(now.getTime() - 7 * 24 * 60 * 60_000),
          ),
          isNull(s.agentEventSubscription.refreshBefore),
        ),
      ),
    )
    .returning({ id: s.agentEventSubscription.id });
  return { expired: expired.length + revoked.length, removed: removed.length };
}
