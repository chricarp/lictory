import { and, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  lock,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { readChannelAccess } from "@lictory/core/channels/access";
import { appendSystemMessage } from "@lictory/core/channels/writer";
import { signalWork } from "@lictory/core/jobs/signal";
import type { SlackClient } from "@lictory/core/channels/slack/api";
import {
  botToken,
  installationOf,
} from "@lictory/core/channels/slack/installation";

// Linking a Lictory channel to a Slack channel
// (docs/internals/channels.md#slack). A person who manages the Lictory
// channel links it to a Slack channel the Lictory app is in; a public
// channel links only to a public Slack channel and a private one only to a
// private one, so linking never widens who can read a conversation. Direct
// conversations are never linked. Unlinking keeps both histories.

export const BACKFILL_MAX = 200;

async function manageable(
  tx: Tx,
  userId: string,
  organizationId: string,
  channelId: string,
) {
  const membership = await authorize(tx, userId, organizationId);
  const access = await readChannelAccess(
    tx,
    organizationId,
    userId,
    channelId,
    isAdmin(membership),
  );
  if (access.channel.kind === "direct")
    throw new DomainError(
      "validation",
      "Direct conversations are not linked to Slack.",
    );
  if (!access.canManage)
    throw new DomainError(
      "forbidden",
      `Only members of #${access.channel.name ?? "this channel"} (or organization administrators, for public channels) link it to Slack.`,
    );
  return access;
}

async function connected(tx: Database | Tx, organizationId: string) {
  const installation = await installationOf(tx, organizationId);
  if (installation?.status !== "connected")
    throw new DomainError(
      "unavailable",
      "Slack is not connected. An organization administrator connects it in Organization settings → Integrations.",
    );
  return installation;
}

/** Slack channels the Lictory app is in, and whether each is linked. */
export async function listSlackChannels(
  db: Database,
  client: SlackClient,
  userId: string,
  organizationId: string,
) {
  const installation = await db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    return connected(tx, organizationId);
  });
  const channels = await client.botChannels(botToken(installation));
  const linked = new Set(
    (
      await db
        .select({ externalId: s.channelExternalLink.externalId })
        .from(s.channelExternalLink)
        .where(
          and(
            eq(s.channelExternalLink.organizationId, organizationId),
            eq(s.channelExternalLink.source, "slack"),
            isNull(s.channelExternalLink.unlinkedAt),
          ),
        )
    ).map((r) => r.externalId),
  );
  return {
    teamName: installation.teamName,
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      isPrivate: c.isPrivate,
      linked: linked.has(c.id),
    })),
  };
}

export function slackChannelUrl(teamUrl: string | null, channelId: string) {
  if (!teamUrl) return null;
  try {
    return new URL(`archives/${encodeURIComponent(channelId)}`, teamUrl).href;
  } catch {
    return null;
  }
}

export async function linkSlackChannel(
  db: Database,
  client: SlackClient,
  userId: string,
  input: {
    organizationId: string;
    channelId: string;
    slackChannelId: string;
    backfill?: number;
  },
) {
  const { organizationId, channelId } = input;
  const backfill = Math.max(0, Math.min(BACKFILL_MAX, input.backfill ?? 0));
  const installation = await db.transaction(async (tx) => {
    await manageable(tx, userId, organizationId, channelId);
    return connected(tx, organizationId);
  });
  // Network outside any transaction.
  const info = await client.channelInfo(
    botToken(installation),
    input.slackChannelId,
  );
  if (!info.isMember)
    throw new DomainError(
      "validation",
      `The Lictory app is not in #${info.name} in Slack. Invite it there first (/invite @Lictory).`,
    );
  if (info.isArchived)
    throw new DomainError("validation", `#${info.name} is archived in Slack.`);
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const access = await manageable(tx, userId, organizationId, channelId);
    const current = await connected(tx, organizationId);
    if (current.teamId !== installation.teamId)
      throw new DomainError(
        "conflict",
        "Slack was reinstalled meanwhile. Try again.",
      );
    if (access.channel.archivedAt)
      throw new DomainError(
        "conflict",
        "This channel is archived. Restore it to link it.",
        undefined,
        "invalid_state",
      );
    const isPrivate = access.channel.kind === "private";
    if (isPrivate !== info.isPrivate)
      throw new DomainError(
        "validation",
        isPrivate
          ? `#${access.channel.name} is private: link it to a private Slack channel, so people outside it never read it in Slack.`
          : `#${access.channel.name} is public in Lictory: link it to a public Slack channel, so a private Slack conversation is never shown to the whole organization.`,
      );
    if (access.channel.externalId) {
      if (
        access.channel.externalSource === "slack" &&
        access.channel.externalId === info.id
      ) {
        const [existing] = await activeLink(tx, organizationId, channelId);
        return { linkId: existing?.id ?? null, replayed: true };
      }
      throw new DomainError(
        "conflict",
        "This channel is already linked to an external channel. Unlink it first.",
      );
    }
    const [taken] = await tx
      .select({ channelId: s.channelExternalLink.channelId })
      .from(s.channelExternalLink)
      .where(
        and(
          eq(s.channelExternalLink.organizationId, organizationId),
          eq(s.channelExternalLink.source, "slack"),
          eq(s.channelExternalLink.externalId, info.id),
          isNull(s.channelExternalLink.unlinkedAt),
        ),
      );
    if (taken)
      throw new DomainError(
        "conflict",
        `#${info.name} in Slack is already linked to another Lictory channel.`,
      );
    const [link] = await tx
      .insert(s.channelExternalLink)
      .values({
        organizationId,
        channelId,
        source: "slack",
        externalId: info.id,
        externalName: info.name,
        externalUrl: slackChannelUrl(current.teamUrl, info.id),
        backfillLimit: backfill,
        linkedById: userId,
      })
      .returning({ id: s.channelExternalLink.id });
    // The system line comes first: it is Lictory's own and is not sent.
    await appendSystemMessage(tx, {
      organizationId,
      channelId,
      actorId: userId,
      kind: "system",
      body: `linked this channel to #${info.name} in Slack`,
    });
    await tx
      .update(s.channel)
      .set({ externalSource: "slack", externalId: info.id })
      .where(
        and(
          eq(s.channel.organizationId, organizationId),
          eq(s.channel.id, channelId),
        ),
      );
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "slack.channel_linked",
      target: { type: "channel", id: channelId, label: access.channel.name },
      detail: { slackChannel: info.id, slackChannelName: info.name, backfill },
    });
    if (backfill) await signalWork(tx, "slack");
    return { linkId: link!.id, replayed: false };
  });
}

function activeLink(
  tx: Database | Tx,
  organizationId: string,
  channelId: string,
) {
  return tx
    .select()
    .from(s.channelExternalLink)
    .where(
      and(
        eq(s.channelExternalLink.organizationId, organizationId),
        eq(s.channelExternalLink.channelId, channelId),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    );
}

/** Stops the sync. Both histories stay where they are. */
export async function unlinkSlackChannel(
  db: Database,
  userId: string,
  input: { organizationId: string; channelId: string },
) {
  const { organizationId, channelId } = input;
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const access = await manageable(tx, userId, organizationId, channelId);
    const [link] = await activeLink(tx, organizationId, channelId);
    if (!link) return { ok: true, replayed: true };
    await tx
      .update(s.channelExternalLink)
      .set({ unlinkedAt: new Date(), unlinkedById: userId })
      .where(eq(s.channelExternalLink.id, link.id));
    await tx
      .update(s.channel)
      .set({ externalSource: null, externalId: null })
      .where(
        and(
          eq(s.channel.organizationId, organizationId),
          eq(s.channel.id, channelId),
        ),
      );
    await tx
      .update(s.channelMirror)
      .set({ dueAt: null, leasedUntil: null })
      .where(eq(s.channelMirror.linkId, link.id));
    if (!access.channel.archivedAt)
      await appendSystemMessage(tx, {
        organizationId,
        channelId,
        actorId: userId,
        kind: "system",
        body: `unlinked this channel from #${link.externalName} in Slack`,
      });
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "slack.channel_unlinked",
      target: { type: "channel", id: channelId, label: access.channel.name },
      detail: { slackChannel: link.externalId },
    });
    return { ok: true, replayed: false };
  });
}
