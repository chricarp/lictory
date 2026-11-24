import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import { agentEventSubscription as machine } from "@lictory/core/contracts/state-machines";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import type { Database } from "@lictory/core/domain/service";
import type { Resolver } from "@lictory/core/lib/egress";
import { describeAgentEvent } from "@lictory/core/agent-events/catalog";
import {
  decodeCursor,
  encodeCursor,
  readAgentEvents,
  type AgentEventView,
} from "@lictory/core/agent-events/feed";
import { webhookHeaders } from "@lictory/core/agent-events/signing";
import {
  agentEventPolicyOf,
  agentScopeOf,
  expireSubscriptions,
  hostAllowed,
  openSecret,
  post,
  previousSecretOf,
  webhookBody,
  type TestOutcome,
} from "@lictory/core/agent-events/subscriptions";

// Delivers agent events to webhooks and MCP Events subscriptions
// (docs/internals/agent-events.md). The email outbox's lease pattern, per
// subscription rather than per message:
//
// - a run claims due subscriptions that have events after their cursor
//   (`FOR UPDATE SKIP LOCKED` plus a two-minute lease), so overlapping
//   workers never deliver the same subscription at once;
// - events go out one at a time, oldest first; the cursor moves past an
//   event only when the receiver accepted it (2xx), so delivery is
//   at-least-once and in order, and a receiver deduplicates by event id;
// - every write is fenced on the lease: a worker that lost its lease
//   cannot move the cursor;
// - a failing event is retried with backoff (30 s, 1, 2, 4 minutes) and the
//   subscription is suspended after five failures (or at once on 410 Gone)
//   until its person resumes it or its MCP client renews it.

type Row = typeof s.agentEventSubscription.$inferSelect;

const LEASE_MS = 2 * 60_000;
// Deliveries start only while this much of the lease remains.
const SEND_MARGIN_MS = 30_000;
export const MAX_DELIVERY_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000];
// Events delivered per subscription per run; the rest wait for the next.
const PER_RUN = 25;

// The identifier of one event's delivery to one subscription: stable across
// retries, unique per message, header-safe. MCP Events receivers dedup by
// it (the OpenAI profile sends it as both `eventId` and `webhook-id`).
function deliveryId(subscriptionId: string, eventId: string) {
  return `evt_${createHash("sha256")
    .update(`${subscriptionId}:${eventId}`)
    .digest("base64url")
    .slice(0, 27)}`;
}

// An event's `data` (MCP `payloadSchema`, agent-events/catalog.ts).
function eventData(event: AgentEventView) {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    organizationId: event.organizationId,
    organizationSlug: event.organizationSlug,
    projectId: event.projectId,
    agentId: event.agentId,
    actorId: event.actorId,
    subject: event.subject,
    url: event.url,
  };
}

async function send(
  row: Row,
  event: AgentEventView,
  now: Date,
  options: { resolve?: Resolver },
): Promise<TestOutcome> {
  const id = deliveryId(row.id, event.id);
  if (row.kind === "mcp") {
    const body = JSON.stringify({
      eventId: id,
      name: event.type,
      timestamp: event.occurredAt,
      data: eventData(event),
      cursor: event.cursor,
    });
    const secrets = [openSecret(row), previousSecretOf(row, now)].filter(
      (secret): secret is string => !!secret,
    );
    return post(
      row.url,
      {
        "content-type": "application/json",
        ...webhookHeaders(secrets, id, Math.floor(now.getTime() / 1000), body),
        "x-mcp-subscription-id": row.id,
      },
      body,
      options,
    );
  }
  const body = webhookBody(
    {
      id,
      type: event.type,
      occurredAt: event.occurredAt,
      cursor: event.cursor,
      data: eventData(event),
    },
    describeAgentEvent(event),
  );
  return post(
    row.url,
    {
      "content-type": "application/json",
      authorization: `Bearer ${openSecret(row)}`,
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
      "x-lictory-event-type": event.type,
    },
    body,
    options,
  );
}

export async function processAgentEventDeliveries(
  db: Database,
  options: {
    limit?: number;
    now?: () => Date;
    resolve?: Resolver;
    signal?: AbortSignal;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const housekeeping = await expireSubscriptions(db, now());
  const at = now();
  const lease = new Date(at.getTime() + LEASE_MS);
  const claimed = await db
    .update(s.agentEventSubscription)
    .set({ leaseUntil: lease })
    .where(
      sql`${s.agentEventSubscription.id} in (
        select sub.id from agent_event_subscription sub
        where sub.status = 'active'
          and sub.next_attempt_at <= ${at.toISOString()}::timestamp
          and (sub.lease_until is null or sub.lease_until < ${at.toISOString()}::timestamp)
          and exists (
            select 1 from agent_event e
            where e.user_id = sub.user_id
              and (sub.organization_id is null or e.organization_id = sub.organization_id)
              and e.seq > sub.cursor_seq)
        order by sub.next_attempt_at
        limit ${options.limit ?? 20}
        for update of sub skip locked)`,
    )
    .returning();
  const outcome = {
    ...housekeeping,
    claimed: claimed.length,
    delivered: 0,
    skipped: 0,
    failed: 0,
    suspended: 0,
  };
  for (const [index, row] of claimed.entries()) {
    if (
      options.signal?.aborted ||
      now().getTime() > lease.getTime() - SEND_MARGIN_MS
    ) {
      for (const rest of claimed.slice(index))
        await db
          .update(s.agentEventSubscription)
          .set({ leaseUntil: null })
          .where(
            and(
              eq(s.agentEventSubscription.id, rest.id),
              eq(s.agentEventSubscription.leaseUntil, lease),
            ),
          );
      break;
    }
    const result = await deliverSubscription(db, row, lease, now, options);
    outcome.delivered += result.delivered;
    outcome.skipped += result.skipped;
    if (result.failed) outcome.failed++;
    if (result.suspended) outcome.suspended++;
  }
  return outcome;
}

async function deliverSubscription(
  db: Database,
  row: Row,
  lease: Date,
  now: () => Date,
  options: { resolve?: Resolver; signal?: AbortSignal },
) {
  const held = and(
    eq(s.agentEventSubscription.id, row.id),
    eq(s.agentEventSubscription.leaseUntil, lease),
  );
  const result = { delivered: 0, skipped: 0, failed: false, suspended: false };
  const settle = (values: PgUpdateSetSource<typeof s.agentEventSubscription>) =>
    db.update(s.agentEventSubscription).set(values).where(held).returning({
      id: s.agentEventSubscription.id,
    });

  // A subscription bound to an agent delivers within its current scope and
  // ends when the agent no longer acts for its person.
  const agent = row.agentId
    ? await agentScopeOf(db, row.agentId, row.userId)
    : null;
  if (row.agentId && !agent) {
    requireStep(machine, row.status, "expire");
    await settle({
      status: "expired",
      statusReason: "Its agent was archived or changed owner.",
      leaseUntil: null,
    });
    return result;
  }
  const host = new URL(row.url).hostname;
  const policies = new Map<string, boolean>();
  const allows = async (organizationId: string) => {
    let allowed = policies.get(organizationId);
    if (allowed === undefined) {
      allowed = hostAllowed(await agentEventPolicyOf(db, organizationId), host);
      policies.set(organizationId, allowed);
    }
    return allowed;
  };

  let cursor = encodeCursor({ seq: row.cursorSeq });
  let attempts = row.attempts;
  let refused: string | null = null;
  while (result.delivered + result.skipped < PER_RUN) {
    let page: Awaited<ReturnType<typeof readAgentEvents>>;
    try {
      page = await readAgentEvents(
        db,
        { userId: row.userId, agent },
        {
          after: cursor,
          organizationId: row.organizationId,
          types: row.eventTypes.length ? (row.eventTypes as never) : null,
          projectIds: row.projectIds,
          limit: PER_RUN,
        },
      );
    } catch (error) {
      // The person left the subscription's organization: nothing it may
      // deliver remains.
      if (!(error instanceof DomainError) || error.category !== "not_found")
        throw error;
      requireStep(machine, row.status, "expire");
      await settle({
        status: "expired",
        statusReason: "Its person is no longer a member of its organization.",
        leaseUntil: null,
      });
      return result;
    }
    for (const event of page.events) {
      if (
        options.signal?.aborted ||
        now().getTime() > lease.getTime() - SEND_MARGIN_MS
      ) {
        await settle({ leaseUntil: null });
        return result;
      }
      // The organization's administrators decide whether its events may
      // go to this host; events they do not allow are passed over.
      if (!(await allows(event.organizationId))) {
        refused = event.organizationSlug;
        result.skipped++;
        cursor = event.cursor;
        continue;
      }
      // An MCP client asked not to receive events older than `maxAgeMs`.
      if (
        row.maxAgeMs &&
        now().getTime() - new Date(event.occurredAt).getTime() > row.maxAgeMs
      ) {
        result.skipped++;
        cursor = event.cursor;
        continue;
      }
      const at = now();
      const sent = await send(row, event, at, options);
      if (sent.ok) {
        const [kept] = await settle({
          cursorSeq: decodeCursor(event.cursor).seq,
          attempts: 0,
          lastAttemptAt: at,
          lastSuccessAt: at,
          lastError: null,
          lastErrorDetail: null,
          failedSince: null,
          deliveredCount: sql`${s.agentEventSubscription.deliveredCount} + 1`,
        });
        if (!kept) return result;
        result.delivered++;
        attempts = 0;
        cursor = event.cursor;
        continue;
      }
      // 413: the receiver will never take this event; pass over it.
      if (sent.status === 413) {
        result.skipped++;
        cursor = event.cursor;
        await settle({
          cursorSeq: decodeCursor(event.cursor).seq,
          lastAttemptAt: at,
          lastError: sent.reason,
          lastErrorDetail: `${sent.detail} The event was skipped.`,
        });
        continue;
      }
      attempts++;
      result.failed = true;
      const gone = sent.status === 410;
      const suspend = gone || attempts >= MAX_DELIVERY_ATTEMPTS;
      if (suspend) requireStep(machine, row.status, "suspend");
      await settle({
        attempts,
        lastAttemptAt: at,
        lastError: sent.reason,
        lastErrorDetail: sent.detail,
        failedSince: row.failedSince ?? at,
        nextAttemptAt: new Date(
          at.getTime() +
            BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!,
        ),
        leaseUntil: null,
        ...(suspend
          ? {
              status: "suspended" as const,
              statusReason: gone
                ? "The receiver answered 410 Gone: it no longer takes these events."
                : `Suspended after ${attempts} failed attempts to deliver one event (${sent.detail}). Resume it once the receiver works again.`,
            }
          : {}),
      });
      result.suspended = suspend;
      return result;
    }
    // Every readable event of the page was handled; dropped ones (no
    // longer readable) advance the cursor too.
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  await settle({
    cursorSeq: decodeCursor(cursor).seq,
    leaseUntil: null,
    ...(refused
      ? {
          lastError: "policy",
          lastErrorDetail: `Events of ${refused} were not sent: its administrators do not allow webhooks to ${host}.`,
        }
      : {}),
  });
  return result;
}
