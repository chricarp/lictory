import { and, eq, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";

// The outbox of linked channels (docs/internals/channels.md#outbound): the
// conversation writer calls this in its own transaction whenever a message
// owned by Lictory, or a Lictory reaction, changes in a channel linked to an
// external chat system. It only writes a row; the worker sends after commit
// (channels/slack/outbound.ts). One row per message (and per emoji of
// Lictory reactions) is both the queue entry and the mapping to the
// external message, so a retry never posts twice and edits coalesce: the
// worker always sends the message as it is when it sends.

type Channel = {
  id: string;
  organizationId: string;
  externalSource: string | null;
};

export async function queueMirror(
  tx: Tx,
  channel: Channel,
  message: {
    id: string;
    externalSource: string | null;
    kind: string;
  },
  target: { kind: "message" } | { kind: "reaction"; emoji: string },
) {
  if (!channel.externalSource) return;
  // Messages written in the external system are owned there: never echoed.
  // (Lictory reactions on them are mirrored: the reaction is Lictory's.)
  if (target.kind === "message" && message.externalSource) return;
  // Lictory's own lifecycle lines (archived, added Ada) stay in Lictory.
  if (target.kind === "message" && message.kind === "system") return;
  const [link] = await tx
    .select({ id: s.channelExternalLink.id })
    .from(s.channelExternalLink)
    .where(
      and(
        eq(s.channelExternalLink.organizationId, channel.organizationId),
        eq(s.channelExternalLink.channelId, channel.id),
        isNull(s.channelExternalLink.unlinkedAt),
      ),
    );
  if (!link) return;
  const emoji = target.kind === "reaction" ? target.emoji : "";
  await tx
    .insert(s.channelMirror)
    .values({
      organizationId: channel.organizationId,
      channelId: channel.id,
      messageId: message.id,
      linkId: link.id,
      target: target.kind,
      emoji,
      dueAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        s.channelMirror.messageId,
        s.channelMirror.target,
        s.channelMirror.emoji,
      ],
      set: {
        linkId: link.id,
        version: sql`${s.channelMirror.version} + 1`,
        dueAt: new Date(),
        attempts: 0,
        failedAt: null,
        lastError: null,
      },
    });
  await signalWork(tx, "slack");
}
