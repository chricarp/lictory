import { and, eq, ne } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import {
  queueNotifications,
  type NotificationNotice,
} from "@lictory/core/notifications/events";
import { plainExcerpt } from "@lictory/core/channels/shared";
import type { ChannelRow } from "@lictory/core/channels/access";

// Who is told about a message (docs/internals/channels.md#notifications).
// Channel traffic notifies nobody by default; a message notifies:
//
// - people it mentions (who can read the channel),
// - the other members of a direct conversation,
// - followers of the thread it replies in,
// - members who chose `all` for the channel.
//
// A member who muted the channel (`none`) is told nothing. One message tells
// a person at most once, the most specific reason winning (a mention beats a
// thread reply). The notification names its channel, so the inbox, the
// unread counts and email re-check channel access on every read.

type MessageRow = typeof s.channelMessage.$inferSelect;

export async function queueChannelNotifications(
  tx: Tx,
  input: {
    channel: ChannelRow;
    message: MessageRow;
    root: MessageRow | null;
    actorId: string;
    mentionedUserIds: string[];
    participantIds: string[];
    // An edit: only newly mentioned people are told.
    mentionsOnly?: boolean;
  },
) {
  const { channel, message, root } = input;
  const direct = channel.kind === "direct";
  // Members whose level differs from the default (or every member of a
  // direct conversation, which are few by definition).
  const levels = await tx
    .select({
      userId: s.channelMember.userId,
      level: s.channelMember.notificationLevel,
    })
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, channel.id),
        eq(s.channelMember.memberKind, "user"),
        ...(direct ? [] : [ne(s.channelMember.notificationLevel, "mentions")]),
      ),
    );
  const muted = new Set(
    levels.filter((l) => l.level === "none").map((l) => l.userId!),
  );
  const keep = (ids: Iterable<string>) =>
    [...ids].filter((id) => !muted.has(id) && id !== input.actorId);
  const detail = {
    // One notification per person and message, whatever the reasons.
    group: `channel-message:${message.id}`,
    channelId: channel.id,
    channelName: channel.name,
    channelKind: channel.kind,
    messageId: message.id,
    threadRootId: root?.id ?? null,
    excerpt: plainExcerpt(message.body),
  };
  const base = {
    actorId: input.actorId,
    projectId: channel.projectId,
    teamId: channel.teamId,
    channelId: channel.id,
    detail,
  };
  const notices: NotificationNotice[] = [
    {
      ...base,
      kind: "channel_mentioned",
      userIds: keep(input.mentionedUserIds),
    },
  ];
  if (!input.mentionsOnly) {
    if (direct)
      notices.push({
        ...base,
        kind: "direct_message",
        userIds: keep(levels.map((l) => l.userId!)),
      });
    if (root)
      notices.push({
        ...base,
        kind: "channel_thread_reply",
        userIds: keep(input.participantIds),
      });
    else if (!direct)
      notices.push({
        ...base,
        kind: "channel_message",
        userIds: keep(
          levels.filter((l) => l.level === "all").map((l) => l.userId!),
        ),
      });
  }
  await queueNotifications(
    tx,
    channel.organizationId,
    notices.filter((n) => [...n.userIds].length > 0),
  );
}
