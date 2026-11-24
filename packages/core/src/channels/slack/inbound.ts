import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { ChannelExternalFile } from "@lictory/core/db/channel-schema";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";
import { addressableAgent } from "@lictory/core/channels/agents";
import {
  appendExternalMessage,
  applyExternalDelete,
  applyExternalEdit,
  applyExternalReaction,
  type ExternalAuthor,
} from "@lictory/core/channels/writer";
import { CHANNEL_MESSAGE_MAX } from "@lictory/core/channels/shared";
import {
  SlackError,
  type SlackClient,
  type SlackFile,
  type SlackMessage,
} from "@lictory/core/channels/slack/api";
import {
  clampImported,
  slackHandles,
  slackReactionToLictory,
  slackToMarkdown,
  slackUserMentions,
} from "@lictory/core/channels/slack/format";
import {
  botToken,
  installationOf,
  markInstallationInvalid,
  signingSecret,
  type InstallationRow,
} from "@lictory/core/channels/slack/installation";
import {
  slackPeople,
  type SlackPerson,
} from "@lictory/core/channels/slack/people";
import { verifySlackSignature } from "@lictory/core/channels/slack/signature";

// Inbound Slack (docs/internals/channels.md#inbound). The Events API
// endpoint verifies the request's signature with the organization's signing
// secret, stores each event once (by Slack's event id) and answers at once,
// well within Slack's 3 seconds; the worker then processes stored events
// under a lease through the conversation writer. Everything a Slack message
// says is information: nothing in its text authorizes an action.

const SOURCE = "slack";
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 6;
// Edits, deletions and reactions can arrive before the message they name
// is processed (another worker, a retry); they wait this many attempts.
const UNKNOWN_RETRIES = 4;
const BACKFILL_THREADS = 20;
const BACKFILL_REPLIES = 50;

export type SlackHttpAnswer = {
  status: number;
  body: string;
  contentType?: string;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const nonEmpty = (value: string | undefined) =>
  value === "" ? undefined : value;

const answer = (status: number, body = ""): SlackHttpAnswer => ({
  status,
  body,
});

/**
 * One request to an organization's Events API or interactivity URL. Returns
 * what to answer Slack. A delivery that fails verification is refused and
 * stores nothing.
 */
export async function receiveSlackRequest(
  db: Database,
  input: {
    organizationId: string;
    kind: "events" | "interactivity";
    headers: { get(name: string): string | null };
    body: string;
    now?: Date;
  },
): Promise<SlackHttpAnswer> {
  const installation = await installationOf(db, input.organizationId);
  if (!installation) return answer(404, "Not found.");
  const check = verifySlackSignature(
    signingSecret(installation),
    input.headers,
    input.body,
    input.now,
  );
  if (!check.ok) return answer(401, `Signature ${check.reason}.`);
  // Buttons on Lictory's cards only open links: acknowledged, nothing runs.
  if (input.kind === "interactivity") return answer(200);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.body) as Record<string, unknown>;
  } catch {
    return answer(400, "Invalid JSON.");
  }
  if (payload.type === "url_verification")
    return {
      status: 200,
      body: JSON.stringify({ challenge: text(payload.challenge) }),
      contentType: "application/json",
    };
  if (payload.type !== "event_callback") return answer(200);
  if (payload.api_app_id !== installation.appId)
    return answer(400, "Event for another app.");
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const eventType = text(event.type);
  const eventId = text(payload.event_id);
  if (!eventId) return answer(400, "Event without id.");
  const lifecycle =
    eventType === "app_uninstalled" || eventType === "tokens_revoked";
  // Only the installed workspace writes into this organization.
  if (
    (installation.status !== "connected" && !lifecycle) ||
    (installation.teamId && payload.team_id !== installation.teamId)
  )
    return answer(200);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(s.slackEvent)
      .values({
        organizationId: installation.organizationId,
        installationId: installation.id,
        eventId,
        eventType,
        payload,
      })
      .onConflictDoNothing()
      .returning({ id: s.slackEvent.id });
    if (!inserted.length) return;
    await tx
      .update(s.slackInstallation)
      .set({ lastEventAt: new Date() })
      .where(
        and(
          eq(s.slackInstallation.id, installation.id),
          or(
            isNull(s.slackInstallation.lastEventAt),
            lte(s.slackInstallation.lastEventAt, new Date(Date.now() - 60_000)),
          ),
        ),
      );
    await signalWork(tx, "slack");
  });
  return answer(200);
}

type EventRow = typeof s.slackEvent.$inferSelect;
type Outcome = { outcome: string } | { retryAfterMs: number; reason: string };

async function claimEvents(db: Database, limit: number) {
  return db.execute<{ id: string }>(sql`
    update ${s.slackEvent} set
      leased_until = now() + ${`${LEASE_MS} milliseconds`}::interval,
      attempts = attempts + 1
    where id in (
      select id from ${s.slackEvent}
      where processed_at is null and failed_at is null and due_at <= now()
        and (leased_until is null or leased_until < now())
      order by received_at
      limit ${limit}
      for update skip locked)
    returning id`);
}

/** Processes due Slack events (the worker's `slack` job). */
export async function processSlackEvents(
  db: Database,
  client: SlackClient,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  const claimed = await claimEvents(db, options.limit ?? 25);
  const counts = {
    claimed: claimed.length,
    processed: 0,
    retried: 0,
    failed: 0,
  };
  if (!claimed.length) return counts;
  const rows = await db
    .select()
    .from(s.slackEvent)
    .where(sql`${s.slackEvent.id} in ${claimed.map((r) => r.id)}`)
    .orderBy(asc(s.slackEvent.receivedAt));
  const installations = new Map<string, InstallationRow | undefined>();
  for (const row of rows) {
    if (options.signal?.aborted) break;
    if (!installations.has(row.organizationId))
      installations.set(
        row.organizationId,
        await installationOf(db, row.organizationId),
      );
    const installation = installations.get(row.organizationId);
    let result: Outcome;
    try {
      result = installation
        ? await handleEvent(db, client, installation, row)
        : { outcome: "ignored: no installation" };
    } catch (error) {
      result = await failure(db, installation, error, row);
    }
    if ("outcome" in result) {
      await settle(db, row, {
        processedAt: new Date(),
        outcome: result.outcome,
      });
      counts.processed++;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      await settle(db, row, { failedAt: new Date(), lastError: result.reason });
      counts.failed++;
    } else {
      await settle(db, row, {
        dueAt: new Date(Date.now() + result.retryAfterMs),
        lastError: result.reason,
      });
      counts.retried++;
    }
  }
  return counts;
}

async function failure(
  db: Database,
  installation: InstallationRow | undefined,
  error: unknown,
  row: EventRow,
): Promise<Outcome> {
  if (error instanceof SlackError) {
    if (error.kind === "rate_limited")
      return {
        retryAfterMs: (error.retryAfterSeconds ?? 30) * 1000,
        reason: error.message,
      };
    if (error.kind === "authentication" && installation) {
      await db.transaction((tx) =>
        markInstallationInvalid(tx, installation.id, error.message),
      );
      return { outcome: `stopped: ${error.code}` };
    }
    if (error.kind === "transient")
      return { retryAfterMs: backoff(row.attempts), reason: error.message };
    return { outcome: `ignored: ${error.code}` };
  }
  console.error(
    JSON.stringify({
      event: "slack.event_failed",
      eventId: row.eventId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return {
    retryAfterMs: backoff(row.attempts),
    reason:
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Processing failed.",
  };
}

const backoff = (attempts: number) =>
  Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

// Fenced by the attempt that claimed the row: a worker that lost its lease
// writes nothing.
async function settle(
  db: Database | Tx,
  row: EventRow,
  set: Partial<typeof s.slackEvent.$inferInsert>,
) {
  await db
    .update(s.slackEvent)
    .set({ ...set, leasedUntil: null })
    .where(
      and(eq(s.slackEvent.id, row.id), eq(s.slackEvent.attempts, row.attempts)),
    );
}

type SlackEventBody = Record<string, unknown> & {
  type?: string;
  subtype?: string;
  channel?: string | { id?: string; name?: string };
  user?: string;
  bot_id?: string;
  app_id?: string;
};

// Loop prevention: events Lictory's own bot caused (its posts, edits and
// reactions) are never ingested again.
function ownBot(
  installation: InstallationRow,
  event: Partial<SlackMessage> & { user?: string },
) {
  return (
    (event.bot_id !== undefined && event.bot_id === installation.botId) ||
    (event.user !== undefined && event.user === installation.botUserId) ||
    (event.app_id !== undefined && event.app_id === installation.appId) ||
    event.bot_profile?.app_id === installation.appId ||
    event.metadata?.event_type === "lictory_message"
  );
}

async function linkOf(
  db: Database | Tx,
  organizationId: string,
  slackChannelId: string,
) {
  const [link] = await db
    .select()
    .from(s.channelExternalLink)
    .where(
      and(
        eq(s.channelExternalLink.organizationId, organizationId),
        eq(s.channelExternalLink.source, SOURCE),
        eq(s.channelExternalLink.externalId, slackChannelId),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    );
  return link;
}

async function handleEvent(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  row: EventRow,
): Promise<Outcome> {
  const event = (row.payload.event ?? {}) as SlackEventBody;
  switch (row.eventType) {
    case "app_uninstalled":
      await db.transaction((tx) =>
        markInstallationInvalid(
          tx,
          installation.id,
          "The Lictory app was uninstalled from Slack. An organization administrator must install it again.",
        ),
      );
      return { outcome: "installation invalid" };
    case "tokens_revoked": {
      const bots = (event.tokens as { bot?: string[] } | undefined)?.bot ?? [];
      if (
        !bots.length ||
        (installation.botUserId && !bots.includes(installation.botUserId))
      )
        return { outcome: "ignored: other tokens" };
      await db.transaction((tx) =>
        markInstallationInvalid(
          tx,
          installation.id,
          "Slack revoked Lictory's token. An organization administrator must install the app again.",
        ),
      );
      return { outcome: "installation invalid" };
    }
    case "channel_rename":
    case "group_rename":
      return renamed(db, installation, event);
    case "member_left_channel":
    case "channel_archive":
    case "group_archive":
      return lostChannel(db, installation, event, row.eventType);
    case "reaction_added":
    case "reaction_removed":
      return reaction(db, client, installation, event, row);
    case "message":
      return message(
        db,
        client,
        installation,
        event as SlackEventBody & SlackMessage,
        row,
      );
    default:
      return { outcome: `ignored: ${row.eventType}` };
  }
}

function channelId(event: SlackEventBody) {
  return typeof event.channel === "string"
    ? event.channel
    : (event.channel?.id ?? "");
}

async function renamed(
  db: Database,
  installation: InstallationRow,
  event: SlackEventBody,
) {
  const channel = typeof event.channel === "object" ? event.channel : undefined;
  if (!channel?.id || !channel.name) return { outcome: "ignored: no channel" };
  await db.transaction(async (tx) => {
    await lock(tx, installation.organizationId);
    await tx
      .update(s.channelExternalLink)
      .set({ externalName: channel.name!.slice(0, 80) })
      .where(
        and(
          eq(s.channelExternalLink.organizationId, installation.organizationId),
          eq(s.channelExternalLink.source, SOURCE),
          eq(s.channelExternalLink.externalId, channel.id!),
          isNull(s.channelExternalLink.unlinkedAt),
        ),
      );
  });
  return { outcome: "renamed" };
}

async function lostChannel(
  db: Database,
  installation: InstallationRow,
  event: SlackEventBody,
  type: string,
) {
  if (type === "member_left_channel" && event.user !== installation.botUserId)
    return { outcome: "ignored: someone else left" };
  const link = await linkOf(db, installation.organizationId, channelId(event));
  if (!link) return { outcome: "ignored: not linked" };
  await markLinkFailing(
    db,
    link.id,
    type === "member_left_channel"
      ? `The Lictory app was removed from #${link.externalName} in Slack. Invite it again (/invite @Lictory).`
      : `#${link.externalName} was archived in Slack.`,
  );
  return { outcome: "link failing" };
}

export async function markLinkFailing(
  db: Database | Tx,
  linkId: string,
  message: string,
) {
  await db
    .update(s.channelExternalLink)
    .set({ health: "failing", lastError: message, lastErrorAt: new Date() })
    .where(eq(s.channelExternalLink.id, linkId));
}

const tsDate = (ts: string | undefined) => {
  const value = Number(ts);
  return Number.isFinite(value) && value > 0
    ? new Date(Math.round(value * 1000))
    : new Date();
};

function filesOf(files: SlackFile[] | undefined): ChannelExternalFile[] {
  return (files ?? [])
    .filter((f) => f.mode !== "tombstone" && f.permalink)
    .slice(0, 20)
    .map((f) => ({
      name: (nonEmpty(f.name) ?? nonEmpty(f.title) ?? "file").slice(0, 200),
      mimeType: (nonEmpty(f.mimetype) ?? "application/octet-stream").slice(
        0,
        120,
      ),
      size: typeof f.size === "number" && f.size >= 0 ? f.size : 0,
      url: f.permalink!,
    }));
}

function authorOf(
  person: SlackPerson | undefined,
  fallbackId: string,
  fallbackName?: string,
): ExternalAuthor {
  if (person?.userId && !person.isBot)
    return {
      kind: "user",
      userId: person.userId,
      externalId: person.slackUserId,
      name: person.name,
    };
  return {
    kind: "external",
    externalId: person?.slackUserId ?? fallbackId,
    name: person?.name ?? fallbackName ?? "Someone",
  };
}

/** Converts a Slack message's text once the author and mentions are known. */
async function convert(
  tx: Tx,
  organizationId: string,
  text: string,
  author: ExternalAuthor,
  people: Map<string, SlackPerson>,
  url?: string,
) {
  // Agent handles resolve only for a mapped person who may address them.
  const agents = new Map<string, { id: string; handle: string }>();
  if (author.kind === "user")
    for (const handle of slackHandles(text).slice(0, 10)) {
      const agent = await addressableAgent(
        tx,
        organizationId,
        author.userId,
        handle,
      );
      if (agent) agents.set(handle, { id: agent.id, handle: agent.handle });
    }
  const body = slackToMarkdown(text, {
    user: (id) => {
      const p = people.get(id);
      return {
        userId: p?.isBot ? null : (p?.userId ?? null),
        name: p?.name ?? id,
      };
    },
    agent: (handle) => agents.get(handle) ?? null,
  });
  return clampImported(body, CHANNEL_MESSAGE_MAX, url);
}

async function message(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  event: SlackEventBody & SlackMessage,
  row: EventRow,
): Promise<Outcome> {
  const slackChannel = channelId(event);
  const link = await linkOf(db, installation.organizationId, slackChannel);
  if (!link) return { outcome: "ignored: not linked" };
  const ref = {
    organizationId: installation.organizationId,
    channelId: link.channelId,
    source: SOURCE,
    externalChannelId: slackChannel,
  };
  if (event.subtype === "message_deleted") {
    const deletedTs = text(event.deleted_ts);
    return db.transaction(async (tx) => {
      const result = await applyExternalDelete(tx, {
        ...ref,
        externalId: deletedTs,
        deletedAt: new Date(),
      });
      return unknownOrDone(result, row);
    });
  }
  if (event.subtype === "message_changed") {
    const changed = (event.message ?? {}) as SlackMessage;
    if (ownBot(installation, changed)) return { outcome: "ignored: own bot" };
    if (changed.subtype === "tombstone")
      return { outcome: "ignored: thread tombstone" };
    const token = botToken(installation);
    const people = await slackPeople(db, client, installation, token, [
      ...(changed.user ? [changed.user] : []),
      ...slackUserMentions(changed.text ?? ""),
    ]);
    const author = authorOf(
      people.get(changed.user ?? ""),
      changed.user ?? changed.bot_id ?? "",
      changed.username,
    );
    return db.transaction(async (tx) => {
      const body = await convert(
        tx,
        ref.organizationId,
        changed.text ?? "",
        author,
        people,
      );
      const result = await applyExternalEdit(tx, {
        ...ref,
        externalId: changed.ts,
        body,
        files: filesOf(changed.files),
        editedAt: tsDate(changed.edited?.ts),
      });
      return unknownOrDone(result, row);
    });
  }
  const supported = [
    undefined,
    "thread_broadcast",
    "file_share",
    "bot_message",
    "me_message",
  ];
  if (!supported.includes(event.subtype))
    return { outcome: `ignored: ${event.subtype}` };
  if (ownBot(installation, event)) return { outcome: "ignored: own bot" };
  return ingestMessage(db, client, installation, ref, event);
}

function unknownOrDone(
  result: { skipped: string } | object,
  row: EventRow,
): Outcome {
  if (
    "skipped" in result &&
    result.skipped === "unknown message" &&
    row.attempts <= UNKNOWN_RETRIES
  )
    return {
      retryAfterMs: 5_000 * row.attempts,
      reason: "Waiting for the message it changes.",
    };
  return {
    outcome: "skipped" in result ? `skipped: ${result.skipped}` : "applied",
  };
}

/** Stores one Slack message (live or imported) through the writer. */
async function ingestMessage(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  ref: {
    organizationId: string;
    channelId: string;
    source: string;
    externalChannelId: string;
  },
  event: SlackMessage,
): Promise<Outcome> {
  const token = botToken(installation);
  const authorId = event.user ?? "";
  const people = await slackPeople(db, client, installation, token, [
    ...(authorId ? [authorId] : []),
    ...slackUserMentions(event.text ?? ""),
  ]);
  const author = authorOf(
    people.get(authorId),
    nonEmpty(authorId) ?? nonEmpty(event.bot_id) ?? "bot",
    event.username ?? event.bot_profile?.name,
  );
  return db.transaction(async (tx) => {
    const body = await convert(
      tx,
      ref.organizationId,
      event.text ?? "",
      author,
      people,
    );
    const result = await appendExternalMessage(tx, {
      ...ref,
      externalId: event.ts,
      threadExternalId: event.thread_ts ?? null,
      author,
      body,
      files: filesOf(event.files),
      createdAt: tsDate(event.ts),
    });
    if ("skipped" in result) return { outcome: `skipped: ${result.skipped}` };
    return { outcome: result.replayed ? "duplicate" : "stored" };
  });
}

async function reaction(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  event: SlackEventBody,
  row: EventRow,
): Promise<Outcome> {
  const item = (event.item ?? {}) as {
    type?: string;
    channel?: string;
    ts?: string;
  };
  if (item.type !== "message" || !item.channel || !item.ts)
    return { outcome: "ignored: not a message" };
  if (event.user && event.user === installation.botUserId)
    return { outcome: "ignored: own bot" };
  const link = await linkOf(db, installation.organizationId, item.channel);
  if (!link) return { outcome: "ignored: not linked" };
  const user = String(event.user ?? "");
  const people = await slackPeople(
    db,
    client,
    installation,
    botToken(installation),
    [user],
  );
  const reactor = authorOf(people.get(user), user);
  return db.transaction(async (tx) => {
    const result = await applyExternalReaction(tx, {
      organizationId: installation.organizationId,
      channelId: link.channelId,
      source: SOURCE,
      externalChannelId: item.channel!,
      messageExternalId: item.ts!,
      emoji: slackReactionToLictory(text(event.reaction)),
      reactor,
      add: row.eventType === "reaction_added",
    });
    return unknownOrDone(result, row);
  });
}

/**
 * Imports the messages from before a link, once per link, bounded: at most
 * the link's `backfillLimit` latest messages and the replies of their most
 * recent threads, oldest first, so they read in Slack's order. Slack's rate
 * limits are respected (a limited run resumes later). This is a bounded
 * import a channel administrator asked for, never a bulk export.
 */
export async function processSlackBackfills(
  db: Database,
  client: SlackClient,
  options: { signal?: AbortSignal } = {},
) {
  const due = await db
    .select()
    .from(s.channelExternalLink)
    .where(
      and(
        eq(s.channelExternalLink.source, SOURCE),
        isNull(s.channelExternalLink.unlinkedAt),
        isNull(s.channelExternalLink.backfilledAt),
        sql`${s.channelExternalLink.backfillLimit} > 0`,
      ),
    )
    .limit(5);
  let imported = 0;
  for (const link of due) {
    if (options.signal?.aborted) break;
    const installation = await installationOf(db, link.organizationId);
    if (installation?.status !== "connected") continue;
    try {
      const token = botToken(installation);
      const history = (
        await client.history(token, link.externalId, link.backfillLimit)
      )
        .filter((m) => !m.thread_ts || m.thread_ts === m.ts)
        .reverse();
      const messages: SlackMessage[] = [];
      const threads = history
        .filter((m) => (m.reply_count ?? 0) > 0)
        .slice(-BACKFILL_THREADS);
      for (const root of history) {
        messages.push(root);
        if (!threads.includes(root)) continue;
        const replies = await client.replies(
          token,
          link.externalId,
          root.ts,
          BACKFILL_REPLIES,
        );
        messages.push(...replies.filter((r) => r.ts !== root.ts));
      }
      const ref = {
        organizationId: link.organizationId,
        channelId: link.channelId,
        source: SOURCE,
        externalChannelId: link.externalId,
      };
      for (const m of messages) {
        if (ownBot(installation, m)) continue;
        if (
          m.subtype &&
          ![
            "thread_broadcast",
            "file_share",
            "bot_message",
            "me_message",
          ].includes(m.subtype)
        )
          continue;
        const result = await ingestMessage(db, client, installation, ref, m);
        if ("outcome" in result && result.outcome === "stored") imported++;
      }
      await db
        .update(s.channelExternalLink)
        .set({ backfilledAt: new Date() })
        .where(eq(s.channelExternalLink.id, link.id));
    } catch (error) {
      if (error instanceof SlackError && error.kind === "rate_limited") break;
      const message =
        error instanceof SlackError
          ? error.message
          : "Importing earlier Slack messages failed.";
      // Not retried in a loop: the link says why and can be relinked.
      await db
        .update(s.channelExternalLink)
        .set({
          backfilledAt: new Date(),
          lastError: message,
          lastErrorAt: new Date(),
        })
        .where(eq(s.channelExternalLink.id, link.id));
      if (error instanceof SlackError && error.kind === "authentication")
        await db.transaction((tx) =>
          markInstallationInvalid(tx, installation.id, message),
        );
    }
  }
  return { links: due.length, imported };
}

/** Removes processed events after a week (failed ones after a month). */
export async function pruneSlackEvents(db: Database) {
  const removed = await db
    .delete(s.slackEvent)
    .where(
      or(
        lte(
          s.slackEvent.processedAt,
          new Date(Date.now() - 7 * 24 * 60 * 60_000),
        ),
        lte(
          s.slackEvent.failedAt,
          new Date(Date.now() - 30 * 24 * 60 * 60_000),
        ),
      ),
    )
    .returning({ id: s.slackEvent.id });
  return removed.length;
}
