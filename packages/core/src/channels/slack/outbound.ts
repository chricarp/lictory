import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { readChannelAccess } from "@lictory/core/channels/access";
import { channelMentions, plainExcerpt } from "@lictory/core/channels/shared";
import { agentDirectory } from "@lictory/core/channels/agents";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { paths } from "@lictory/core/lib/paths";
import { signalWork } from "@lictory/core/jobs/signal";
import { SlackError, type SlackClient } from "@lictory/core/channels/slack/api";
import {
  cardBlocks,
  lictoryEmojiToSlack,
  markdownToSlack,
  slackFallback,
} from "@lictory/core/channels/slack/format";
import {
  botToken,
  installationOf,
  markInstallationInvalid,
  type InstallationRow,
} from "@lictory/core/channels/slack/installation";
import { slackIdsOf } from "@lictory/core/channels/slack/people";
import { markLinkFailing } from "@lictory/core/channels/slack/inbound";

// Outbound Slack (docs/internals/channels.md#outbound): the worker works
// through `channel_mirror` after commit. Each row names one Lictory-owned
// message (or one emoji of Lictory reactions on a message); the worker makes
// Slack match the message as it is now, so edits coalesce, and settles only
// the version it sent. Posting is idempotent by the Lictory message id: it
// travels as message metadata, and a retry after an unanswered post finds the
// first post in the channel's recent history instead of posting twice.
// Rate limits wait for Slack's Retry-After; other failures back off and,
// after a few attempts, show on the message with a Retry action.

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 6;
const PARENT_WAIT_MS = 5_000;

type MirrorRow = typeof s.channelMirror.$inferSelect;
type MessageRow = typeof s.channelMessage.$inferSelect;

type Result =
  | { done: true; externalId?: string | null; present?: boolean }
  | { later: number; reason?: string; countAttempt?: boolean }
  | { failed: string; link?: string };

async function claim(db: Database, limit: number) {
  return db.execute<{ id: string }>(sql`
    update ${s.channelMirror} set
      leased_until = now() + ${`${LEASE_MS} milliseconds`}::interval,
      attempts = attempts + 1
    where id in (
      select id from ${s.channelMirror}
      where due_at is not null and due_at <= now() and failed_at is null
        and (leased_until is null or leased_until < now())
      order by due_at
      limit ${limit}
      for update skip locked)
    returning id`);
}

/** Sends due mirror rows to Slack (the worker's `slack` job). */
export async function processChannelMirrors(
  db: Database,
  client: SlackClient,
  options: { limit?: number; signal?: AbortSignal } = {},
) {
  const claimed = await claim(db, options.limit ?? 25);
  const counts = { claimed: claimed.length, sent: 0, retried: 0, failed: 0 };
  if (!claimed.length) return counts;
  const rows = await db
    .select()
    .from(s.channelMirror)
    .where(
      inArray(
        s.channelMirror.id,
        claimed.map((r) => r.id),
      ),
    )
    .orderBy(s.channelMirror.createdAt);
  const installations = new Map<string, InstallationRow | undefined>();
  for (const row of rows) {
    if (options.signal?.aborted) break;
    if (!installations.has(row.organizationId))
      installations.set(
        row.organizationId,
        await installationOf(db, row.organizationId),
      );
    const installation = installations.get(row.organizationId);
    let result: Result;
    try {
      result = await send(db, client, installation, row);
    } catch (error) {
      result = await failure(db, installation, row, error);
    }
    await settle(db, row, result);
    if ("done" in result) counts.sent++;
    else if ("failed" in result) counts.failed++;
    else counts.retried++;
  }
  return counts;
}

async function failure(
  db: Database,
  installation: InstallationRow | undefined,
  row: MirrorRow,
  error: unknown,
): Promise<Result> {
  if (error instanceof SlackError) {
    switch (error.kind) {
      case "rate_limited":
        return {
          later: (error.retryAfterSeconds ?? 30) * 1000,
          reason: error.message,
          countAttempt: false,
        };
      case "authentication":
        if (installation)
          await db.transaction((tx) =>
            markInstallationInvalid(tx, installation.id, error.message),
          );
        return { failed: error.message };
      case "channel":
        return { failed: error.message, link: error.message };
      case "transient":
        return row.attempts >= MAX_ATTEMPTS
          ? { failed: error.message }
          : { later: backoff(row.attempts), reason: error.message };
      case "rejected":
        return { failed: error.message };
    }
  }
  console.error(
    JSON.stringify({
      event: "slack.mirror_failed",
      mirrorId: row.id,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return row.attempts >= MAX_ATTEMPTS
    ? { failed: "Lictory could not send this to Slack." }
    : { later: backoff(row.attempts), reason: "Sending to Slack failed." };
}

export const backoff = (attempts: number) =>
  Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));

// Fenced by the claiming attempt. A version newer than the one claimed
// (an edit while sending) stays due.
async function settle(db: Database, row: MirrorRow, result: Result) {
  await db.transaction(async (tx) => {
    const fence = and(
      eq(s.channelMirror.id, row.id),
      eq(s.channelMirror.attempts, row.attempts),
    );
    if ("done" in result) {
      await tx
        .update(s.channelMirror)
        .set({
          ...(result.externalId !== undefined
            ? { externalId: result.externalId }
            : {}),
          ...(result.present !== undefined ? { present: result.present } : {}),
          syncedVersion: row.version,
          syncedAt: new Date(),
          leasedUntil: null,
          lastError: null,
          attempts: 0,
          dueAt: sql`case when ${s.channelMirror.version} > ${row.version} then now() else null end`,
        })
        .where(fence);
      await tx
        .update(s.channelExternalLink)
        .set({
          health: "ok",
          lastError: null,
          lastErrorAt: null,
          lastSyncedAt: new Date(),
        })
        .where(
          and(
            eq(s.channelExternalLink.id, row.linkId),
            sql`(${s.channelExternalLink.health} <> 'ok' or ${s.channelExternalLink.lastSyncedAt} is null
              or ${s.channelExternalLink.lastSyncedAt} < now() - interval '1 minute')`,
          ),
        );
      return;
    }
    if ("later" in result) {
      await tx
        .update(s.channelMirror)
        .set({
          dueAt: new Date(Date.now() + result.later),
          leasedUntil: null,
          lastError: result.reason ?? null,
          ...(result.countAttempt === false
            ? { attempts: sql`greatest(${s.channelMirror.attempts} - 1, 0)` }
            : {}),
        })
        .where(fence);
      return;
    }
    await tx
      .update(s.channelMirror)
      .set({
        failedAt: new Date(),
        lastError: result.failed,
        leasedUntil: null,
        dueAt: null,
      })
      .where(fence);
    if (result.link) await markLinkFailing(tx, row.linkId, result.link);
  });
}

async function load(db: Database, row: MirrorRow) {
  const [link] = await db
    .select()
    .from(s.channelExternalLink)
    .where(eq(s.channelExternalLink.id, row.linkId));
  const [message] = await db
    .select()
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.organizationId, row.organizationId),
        eq(s.channelMessage.id, row.messageId),
      ),
    );
  return { link, message };
}

// The Slack ts of a Lictory message: its own when it was written in Slack,
// else the ts Lictory posted it as.
async function slackTs(db: Database, message: MessageRow) {
  if (message.externalSource === "slack") return message.externalId;
  const [mirror] = await db
    .select({ externalId: s.channelMirror.externalId })
    .from(s.channelMirror)
    .where(
      and(
        eq(s.channelMirror.messageId, message.id),
        eq(s.channelMirror.target, "message"),
      ),
    );
  return mirror?.externalId ?? null;
}

async function send(
  db: Database,
  client: SlackClient,
  installation: InstallationRow | undefined,
  row: MirrorRow,
): Promise<Result> {
  const { link, message } = await load(db, row);
  // Unlinked meanwhile, or the message is gone: nothing to send.
  if (!link || link.unlinkedAt || !message) return { done: true };
  if (installation?.status !== "connected")
    return {
      failed:
        "Slack is not connected. An organization administrator must install the Slack app again.",
    };
  const token = botToken(installation);
  const channel = link.externalId;
  if (row.target === "reaction") {
    const name = lictoryEmojiToSlack(row.emoji);
    if (!name) return { done: true };
    const ts = await slackTs(db, message);
    if (!ts)
      return message.deletedAt
        ? { done: true }
        : { later: PARENT_WAIT_MS, countAttempt: false };
    const [wanted] = await db
      .select({ id: s.channelReaction.id })
      .from(s.channelReaction)
      .where(
        and(
          eq(s.channelReaction.messageId, message.id),
          eq(s.channelReaction.emoji, row.emoji),
          isNull(s.channelReaction.externalSource),
        ),
      )
      .limit(1);
    const want = wanted !== undefined && !message.deletedAt;
    if (want === row.present) return { done: true, present: want };
    if (want) await client.addReaction(token, channel, ts, name);
    else await client.removeReaction(token, channel, ts, name);
    return { done: true, present: want };
  }
  // The message itself.
  if (message.deletedAt) {
    if (row.externalId)
      await client.deleteMessage(token, channel, row.externalId);
    return { done: true };
  }
  const rendered = await render(db, client, installation, token, message);
  if (row.externalId) {
    await client.updateMessage(token, {
      channel,
      ts: row.externalId,
      text: rendered.text,
      ...(rendered.blocks ? { blocks: rendered.blocks } : {}),
    });
    return { done: true };
  }
  let threadTs: string | null = null;
  if (message.threadRootId) {
    const [root] = await db
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, message.organizationId),
          eq(s.channelMessage.id, message.threadRootId),
        ),
      );
    threadTs = root ? await slackTs(db, root) : null;
    // The thread's first message has not reached Slack yet.
    if (root && !threadTs) {
      const rootMirror = await db
        .select({ id: s.channelMirror.id })
        .from(s.channelMirror)
        .where(
          and(
            eq(s.channelMirror.messageId, root.id),
            eq(s.channelMirror.target, "message"),
          ),
        );
      if (rootMirror.length && !root.deletedAt)
        return { later: PARENT_WAIT_MS, countAttempt: false };
    }
  }
  // A previous attempt may have posted without hearing back.
  if (row.attempts > 1) {
    const found = await findPosted(
      client,
      token,
      channel,
      threadTs,
      message.id,
    );
    if (found) return { done: true, externalId: found };
  }
  const posted = await client.postMessage(token, {
    channel,
    text: rendered.text,
    ...(rendered.blocks ? { blocks: rendered.blocks } : {}),
    threadTs,
    username: rendered.username,
    iconUrl: rendered.iconUrl,
    lictoryMessageId: message.id,
  });
  return { done: true, externalId: posted.ts };
}

async function findPosted(
  client: SlackClient,
  token: string,
  channel: string,
  threadTs: string | null,
  messageId: string,
) {
  const recent = threadTs
    ? await client.replies(token, channel, threadTs, 100)
    : await client.history(token, channel, 100, { includeMetadata: true });
  const match = recent.find(
    (m) =>
      m.metadata?.event_type === "lictory_message" &&
      m.metadata.event_payload?.message_id === messageId,
  );
  return match?.ts ?? null;
}

const httpsUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
};

async function render(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  token: string,
  message: MessageRow,
) {
  const [org] = await db
    .select({ slug: s.organization.slug })
    .from(s.organization)
    .where(eq(s.organization.id, message.organizationId));
  const link = `${platformUrl().replace(/\/$/, "")}${paths.channel(org?.slug ?? "", message.channelId)}`;
  const mentioned = channelMentions(message.body).userIds;
  const slackIds = await slackIdsOf(db, client, installation, token, mentioned);
  const text = markdownToSlack(message.body, {
    slackUser: (id) => slackIds.get(id) ?? null,
  });
  const people = [message.authorUserId, message.onBehalfOfUserId].filter(
    (id): id is string => Boolean(id),
  );
  const names = new Map(
    (people.length
      ? await db
          .select({ id: s.user.id, name: s.user.name, image: s.user.image })
          .from(s.user)
          .where(inArray(s.user.id, people))
      : []
    ).map((u) => [u.id, u]),
  );
  const files = message.attachments.length
    ? `\n${message.attachments.map((f) => `📎 <${link}|${f.filename.replace(/[<>|]/g, "")}> (in Lictory)`).join("\n")}`
    : "";
  if (message.kind === "card") {
    const actor = names.get(message.authorUserId ?? "")?.name ?? "Someone";
    const summary = `*${actor}* ${text}`;
    return {
      text: slackFallback(`${actor} ${plainExcerpt(message.body, 2000)}`),
      blocks: cardBlocks({ text: summary, url: link }),
      username: "Lictory",
      iconUrl: null,
    };
  }
  if (message.authorKind === "agent") {
    const [agent] = message.authorAgentId
      ? await agentDirectory().agents(
          db as unknown as Tx,
          message.organizationId,
          [message.authorAgentId],
        )
      : [];
    const owner =
      names.get(message.onBehalfOfUserId ?? "")?.name ?? "its owner";
    const agentName = agent?.name ?? "Agent";
    return {
      text: slackFallback(text + files),
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: (text + files).slice(0, 2900) || " " },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${agentName} via ${owner} · <${link}|Open in Lictory>`,
            },
          ],
        },
      ],
      username: `${agentName} (via ${owner})`.slice(0, 80),
      iconUrl: httpsUrl(agent?.avatarUrl),
    };
  }
  const author = names.get(message.authorUserId ?? "");
  return {
    text: slackFallback(text + files) || " ",
    blocks: undefined,
    username: (author?.name ?? "Lictory").slice(0, 80),
    iconUrl: httpsUrl(author?.image),
  };
}

/**
 * Retries sending a message that could not reach Slack: its author, or
 * someone who manages the channel. Goes through the conversation's locks
 * like the writer.
 */
export async function retryChannelMirror(
  db: Database,
  userId: string,
  input: { organizationId: string; channelId: string; messageId: string },
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${input.organizationId}, 0))`,
    );
    const membership = await authorize(tx, userId, input.organizationId);
    const access = await readChannelAccess(
      tx,
      input.organizationId,
      userId,
      input.channelId,
      isAdmin(membership),
    );
    const [message] = await tx
      .select({
        authorUserId: s.channelMessage.authorUserId,
        onBehalfOf: s.channelMessage.onBehalfOfUserId,
      })
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, input.organizationId),
          eq(s.channelMessage.channelId, input.channelId),
          eq(s.channelMessage.id, input.messageId),
        ),
      );
    if (!message)
      throw new DomainError("not_found", "This message is unavailable.");
    const own =
      message.authorUserId === userId || message.onBehalfOf === userId;
    if (!own && !access.canManage)
      throw new DomainError(
        "forbidden",
        "Only the message's author or someone who manages the channel can retry sending it.",
      );
    const retried = await tx
      .update(s.channelMirror)
      .set({
        failedAt: null,
        lastError: null,
        attempts: 0,
        dueAt: new Date(),
        leasedUntil: null,
      })
      .where(
        and(
          eq(s.channelMirror.organizationId, input.organizationId),
          eq(s.channelMirror.channelId, input.channelId),
          eq(s.channelMirror.messageId, input.messageId),
          sql`${s.channelMirror.failedAt} is not null`,
        ),
      )
      .returning({ id: s.channelMirror.id });
    if (retried.length) await signalWork(tx, "slack");
    return { retried: retried.length };
  });
}
