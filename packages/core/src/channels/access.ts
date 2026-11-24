import { and, eq, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database, Tx } from "@lictory/core/domain/service";

// Who may do what in a channel (docs/internals/channels.md#access). The same
// rules back the synced queries (packages/zero/src/queries.ts), the
// conversation writer, channel commands, files and notifications:
//
// - read: a public channel, by any organization member; a private or direct
//   one, by its members only. Non-members of a private channel cannot tell
//   it exists: every refusal reads "not found".
// - post, reply: members of an active (unarchived) channel.
// - react: anyone who reads an active channel.
// - manage (rename, topic, archive, add or remove members): members of a
//   public or private channel, and organization administrators. Direct
//   conversations have fixed members and are never renamed or archived.
//
// Membership in the organization (with its two-factor and deletion locks)
// is checked separately by `authorize`, inside the same transaction.

export type ChannelRow = typeof s.channel.$inferSelect;
type ChannelMemberRow = typeof s.channelMember.$inferSelect;

export type ChannelAccess = {
  channel: ChannelRow;
  member: ChannelMemberRow | undefined;
  canRead: boolean;
  canPost: boolean;
  canReact: boolean;
  canManage: boolean;
};

function channelAccessOf(
  channel: ChannelRow,
  member: ChannelMemberRow | undefined,
  admin: boolean,
): ChannelAccess {
  const canRead = channel.kind === "public" || member !== undefined;
  const active = !channel.archivedAt;
  return {
    channel,
    member,
    canRead,
    canPost: active && member !== undefined,
    canReact: active && canRead,
    // Administrators manage public channels; a private channel is managed
    // by its members (administrators who are not members cannot read it).
    canManage:
      channel.kind !== "direct" && canRead && (member !== undefined || admin),
  };
}

const channelNotFound = () =>
  new DomainError("not_found", "This channel is unavailable.");

/** Loads a channel with the person's membership, or refuses as not found. */
export async function readChannelAccess(
  tx: Tx | Database,
  organizationId: string,
  userId: string,
  channelId: string,
  admin: boolean,
  options: { forUpdate?: boolean } = {},
): Promise<ChannelAccess> {
  const query = tx
    .select()
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, organizationId),
        eq(s.channel.id, channelId),
      ),
    );
  const [channel] = options.forUpdate ? await query.for("update") : await query;
  if (!channel) throw channelNotFound();
  const [member] = await tx
    .select()
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.organizationId, organizationId),
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.userId, userId),
      ),
    );
  const access = channelAccessOf(channel, member, admin);
  // Private and direct channels do not exist for non-members.
  if (!access.canRead) throw channelNotFound();
  return access;
}

/** Channel ids among `channelIds` that `userId` may read. */
export async function readableChannelIds(
  tx: Tx | Database,
  organizationId: string,
  userId: string,
  channelIds: readonly string[],
): Promise<Set<string>> {
  if (!channelIds.length) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select c.id from ${s.channel} c
    where c.organization_id = ${organizationId}
      and c.id in (${sql.join(
        channelIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      and (c.kind = 'public' or exists (
        select 1 from ${s.channelMember} cm
        where cm.channel_id = c.id and cm.user_id = ${userId}))`);
  return new Set(rows.map((r) => r.id));
}

/** Whether `userId` is a member of the channel (for typing signals). */
export async function isChannelMember(
  tx: Tx | Database,
  organizationId: string,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: s.channelMember.id })
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.organizationId, organizationId),
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.userId, userId),
      ),
    );
  return row !== undefined;
}
