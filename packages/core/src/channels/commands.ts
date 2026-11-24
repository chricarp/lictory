import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { ChannelCommand } from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import type { Tx } from "@lictory/core/domain/service";
import {
  readChannelAccess,
  type ChannelAccess,
} from "@lictory/core/channels/access";
import { agentDirectory } from "@lictory/core/channels/agents";
import {
  DIRECT_MEMBERS_MAX,
  directKey,
  participantKey,
} from "@lictory/core/channels/shared";
import { appendSystemMessage } from "@lictory/core/channels/writer";

// Channel structure and membership (docs/internals/channels.md#commands).
// Ordinary commands: `applyMutation` has taken the organization lock
// exclusively, checked membership and the idempotency receipt; this writes
// the channel rows (which are themselves the synchronized shape, authorized
// by channel access) and the system messages that tell members what
// changed, in the same transaction.

type Context = {
  organizationId: string;
  userId: string;
  admin: boolean;
};

export async function applyChannelCommand(
  tx: Tx,
  ctx: Context,
  c: ChannelCommand,
): Promise<Record<string, unknown> | undefined> {
  switch (c.type) {
    case "createChannel":
      return createChannel(tx, ctx, c);
    case "openDirectConversation":
      return openDirectConversation(tx, ctx, c);
    case "updateChannel":
      return updateChannel(tx, ctx, c);
    case "setChannelArchived":
      return setArchived(tx, ctx, c);
    case "joinChannel":
      return join(tx, ctx, c.channelId);
    case "leaveChannel":
      return leave(tx, ctx, c.channelId);
    case "addChannelMembers":
      return addMembers(tx, ctx, c);
    case "removeChannelMember":
      return removeMember(tx, ctx, c);
    case "setChannelNotificationLevel": {
      const access = await accessOf(tx, ctx, c.channelId);
      if (!access.member)
        throw new DomainError(
          "conflict",
          "Join the channel to choose its notifications.",
        );
      await tx
        .update(s.channelMember)
        .set({ notificationLevel: c.level })
        .where(eq(s.channelMember.id, access.member.id));
      return undefined;
    }
  }
}

const accessOf = (tx: Tx, ctx: Context, channelId: string) =>
  readChannelAccess(tx, ctx.organizationId, ctx.userId, channelId, ctx.admin, {
    forUpdate: true,
  });

const label = (access: ChannelAccess) =>
  access.channel.name ? `#${access.channel.name}` : "direct conversation";

function requireManage(access: ChannelAccess) {
  if (access.channel.kind === "direct")
    throw new DomainError(
      "validation",
      "Direct conversations have fixed members and cannot be changed.",
    );
  if (!access.canManage)
    throw new DomainError("forbidden", `Join ${label(access)} to change it.`);
}

function requireActive(access: ChannelAccess) {
  if (access.channel.archivedAt)
    throw new DomainError(
      "conflict",
      `${label(access)} is archived. Restore it first.`,
      undefined,
      "invalid_state",
    );
}

async function requireNameFree(
  tx: Tx,
  organizationId: string,
  name: string,
  except?: string,
) {
  const [taken] = await tx
    .select({ id: s.channel.id, archivedAt: s.channel.archivedAt })
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, organizationId),
        sql`lower(${s.channel.name}) = ${name.toLowerCase()}`,
      ),
    );
  if (taken && taken.id !== except)
    throw new DomainError(
      "conflict",
      taken.archivedAt
        ? `An archived channel is named #${name}. Restore it or choose another name.`
        : `A channel named #${name} already exists.`,
    );
}

async function requireHome(
  tx: Tx,
  organizationId: string,
  home: { projectId: string; teamId?: string } | null | undefined,
) {
  if (!home) return { projectId: null, teamId: null };
  const [project] = await tx
    .select({ id: s.project.id })
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, organizationId),
        eq(s.project.id, home.projectId),
        isNull(s.project.archivedAt),
      ),
    );
  if (!project)
    throw new DomainError("not_found", "This project is unavailable.");
  if (home.teamId) {
    const [team] = await tx
      .select({ id: s.team.id })
      .from(s.team)
      .where(
        and(
          eq(s.team.organizationId, organizationId),
          eq(s.team.projectId, home.projectId),
          eq(s.team.id, home.teamId),
          isNull(s.team.archivedAt),
        ),
      );
    if (!team) throw new DomainError("not_found", "This team is unavailable.");
  }
  return { projectId: home.projectId, teamId: home.teamId ?? null };
}

// Organization members among `userIds`; anyone else is refused by name of
// the problem, not of the person.
async function requireMembers(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return [];
  const rows = await tx
    .select({ userId: s.member.userId })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        inArray(s.member.userId, unique),
      ),
    );
  if (rows.length !== unique.length)
    throw new DomainError(
      "validation",
      "Only members of this organization can join its channels.",
    );
  return unique;
}

async function requireAgents(
  tx: Tx,
  organizationId: string,
  agentIds: readonly string[],
) {
  const unique = [...new Set(agentIds)];
  if (!unique.length) return [];
  const agents = await agentDirectory().agents(tx, organizationId, unique);
  if (agents.length !== unique.length)
    throw new DomainError("validation", "One of these agents is unavailable.");
  return agents;
}

async function insertMembers(
  tx: Tx,
  ctx: Context,
  channelId: string,
  members: {
    userIds: readonly string[];
    agentIds: readonly string[];
    level: "all" | "mentions";
  },
  // A member joining an existing channel starts with everything read.
  cursor?: { readSequence: number; readRootCount: number },
) {
  const rows = [
    ...members.userIds.map((userId) => ({
      memberKind: "user" as const,
      userId,
      agentId: null,
    })),
    ...members.agentIds.map((agentId) => ({
      memberKind: "agent" as const,
      userId: null,
      agentId,
    })),
  ];
  if (!rows.length) return [];
  return tx
    .insert(s.channelMember)
    .values(
      rows.map((r) => ({
        ...r,
        organizationId: ctx.organizationId,
        channelId,
        notificationLevel: members.level,
        addedById: ctx.userId,
        readSequence: cursor?.readSequence ?? 0,
        readRootCount: cursor?.readRootCount ?? 0,
      })),
    )
    .onConflictDoNothing()
    .returning({
      userId: s.channelMember.userId,
      agentId: s.channelMember.agentId,
    });
}

async function createChannel(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "createChannel" }>,
) {
  await requireNameFree(tx, ctx.organizationId, c.name);
  const home = await requireHome(tx, ctx.organizationId, c.home);
  const memberIds = await requireMembers(tx, ctx.organizationId, [
    ctx.userId,
    ...(c.memberIds ?? []),
  ]);
  await tx.insert(s.channel).values({
    id: c.channelId,
    organizationId: ctx.organizationId,
    kind: c.kind,
    name: c.name,
    topic: c.topic ?? "",
    ...home,
    createdById: ctx.userId,
  });
  await insertMembers(tx, ctx, c.channelId, {
    userIds: memberIds,
    agentIds: [],
    level: "mentions",
  });
  await recordAuditEvent(tx, {
    organizationId: ctx.organizationId,
    actor: { id: ctx.userId },
    action: "channel.created",
    target: { type: "channel", id: c.channelId, label: `#${c.name}` },
    detail: { kind: c.kind, members: memberIds.length },
  });
  return { channelId: c.channelId };
}

async function openDirectConversation(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "openDirectConversation" }>,
) {
  const userIds = await requireMembers(tx, ctx.organizationId, [
    ctx.userId,
    ...c.userIds,
  ]);
  const agents = await requireAgents(tx, ctx.organizationId, c.agentIds ?? []);
  if (userIds.length - 1 + agents.length > DIRECT_MEMBERS_MAX)
    throw new DomainError(
      "validation",
      `A direct conversation has at most ${DIRECT_MEMBERS_MAX + 1} members. Create a private channel for more people.`,
    );
  const key = directKey([
    ...userIds.map((id) => participantKey("user", id)),
    ...agents.map((a) => participantKey("agent", a.id)),
  ]);
  const [existing] = await tx
    .select({ id: s.channel.id })
    .from(s.channel)
    .where(
      and(
        eq(s.channel.organizationId, ctx.organizationId),
        eq(s.channel.directKey, key),
      ),
    );
  if (existing) return { channelId: existing.id, existing: true };
  await tx.insert(s.channel).values({
    id: c.channelId,
    organizationId: ctx.organizationId,
    kind: "direct",
    name: null,
    directKey: key,
    createdById: ctx.userId,
  });
  await insertMembers(tx, ctx, c.channelId, {
    userIds,
    agentIds: agents.map((a) => a.id),
    level: "all",
  });
  return { channelId: c.channelId, existing: false };
}

async function updateChannel(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "updateChannel" }>,
) {
  const access = await accessOf(tx, ctx, c.channelId);
  requireManage(access);
  requireActive(access);
  const set: Partial<typeof s.channel.$inferInsert> = {};
  const notes: string[] = [];
  if (c.name !== undefined && c.name !== access.channel.name) {
    await requireNameFree(tx, ctx.organizationId, c.name, c.channelId);
    set.name = c.name;
    notes.push(`renamed the channel to #${c.name}`);
  }
  if (c.topic !== undefined && c.topic !== access.channel.topic) {
    set.topic = c.topic;
    notes.push(c.topic ? `set the topic: ${c.topic}` : "cleared the topic");
  }
  if (c.home !== undefined) {
    const home = await requireHome(tx, ctx.organizationId, c.home);
    if (
      home.projectId !== access.channel.projectId ||
      home.teamId !== access.channel.teamId
    )
      Object.assign(set, home);
  }
  if (!Object.keys(set).length) return undefined;
  await tx.update(s.channel).set(set).where(eq(s.channel.id, c.channelId));
  for (const note of notes)
    await appendSystemMessage(tx, {
      organizationId: ctx.organizationId,
      channelId: c.channelId,
      actorId: ctx.userId,
      kind: "system",
      body: note,
    });
  return undefined;
}

async function setArchived(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "setChannelArchived" }>,
) {
  const access = await accessOf(tx, ctx, c.channelId);
  requireManage(access);
  if (Boolean(access.channel.archivedAt) === c.archived) return undefined;
  // Told before archiving and after restoring, so the line itself is not
  // refused by the archive.
  if (!c.archived)
    await tx
      .update(s.channel)
      .set({ archivedAt: null, archivedById: null })
      .where(eq(s.channel.id, c.channelId));
  await appendSystemMessage(tx, {
    organizationId: ctx.organizationId,
    channelId: c.channelId,
    actorId: ctx.userId,
    kind: "system",
    body: c.archived ? "archived the channel" : "restored the channel",
  });
  if (c.archived)
    await tx
      .update(s.channel)
      .set({ archivedAt: new Date(), archivedById: ctx.userId })
      .where(eq(s.channel.id, c.channelId));
  await recordAuditEvent(tx, {
    organizationId: ctx.organizationId,
    actor: { id: ctx.userId },
    action: c.archived ? "channel.archived" : "channel.restored",
    target: { type: "channel", id: c.channelId, label: label(access) },
  });
  return undefined;
}

async function join(tx: Tx, ctx: Context, channelId: string) {
  const access = await accessOf(tx, ctx, channelId);
  if (access.member) return undefined;
  // Private and direct channels are not visible to non-members, so
  // `accessOf` already refused them; only public channels get here.
  requireActive(access);
  await insertMembers(
    tx,
    ctx,
    channelId,
    { userIds: [ctx.userId], agentIds: [], level: "mentions" },
    {
      readSequence: access.channel.lastSequence,
      readRootCount: access.channel.rootCount,
    },
  );
  return undefined;
}

async function leave(tx: Tx, ctx: Context, channelId: string) {
  const access = await accessOf(tx, ctx, channelId);
  if (access.channel.kind === "direct")
    throw new DomainError(
      "validation",
      "Direct conversations cannot be left. Mute it instead.",
    );
  if (!access.member) return undefined;
  if (access.channel.kind === "private") await requireNotLast(tx, access);
  await tx
    .delete(s.channelMember)
    .where(eq(s.channelMember.id, access.member.id));
  if (access.channel.kind === "private")
    await recordAuditEvent(tx, {
      organizationId: ctx.organizationId,
      actor: { id: ctx.userId },
      action: "channel.member_removed",
      target: { type: "channel", id: channelId, label: label(access) },
      detail: { userId: ctx.userId, left: true },
    });
  return undefined;
}

// The last person in a private channel would leave it unreadable forever.
async function requireNotLast(tx: Tx, access: ChannelAccess) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, access.channel.id),
        eq(s.channelMember.memberKind, "user"),
      ),
    );
  if ((row?.count ?? 0) <= 1)
    throw new DomainError(
      "conflict",
      `You are the last person in ${label(access)}. Archive it instead, or add someone first.`,
    );
}

async function addMembers(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "addChannelMembers" }>,
) {
  const access = await accessOf(tx, ctx, c.channelId);
  requireManage(access);
  requireActive(access);
  const userIds = await requireMembers(tx, ctx.organizationId, c.userIds ?? []);
  const agents = await requireAgents(tx, ctx.organizationId, c.agentIds ?? []);
  const added = await insertMembers(tx, ctx, c.channelId, {
    userIds,
    agentIds: agents.map((a) => a.id),
    level: "mentions",
  });
  if (access.channel.kind === "private")
    for (const member of added)
      await recordAuditEvent(tx, {
        organizationId: ctx.organizationId,
        actor: { id: ctx.userId },
        action: "channel.member_added",
        target: { type: "channel", id: c.channelId, label: label(access) },
        detail: member.userId
          ? { userId: member.userId }
          : { agentId: member.agentId },
      });
  const names = added.length ? await describeMembers(tx, added, agents) : [];
  if (names.length)
    await appendSystemMessage(tx, {
      organizationId: ctx.organizationId,
      channelId: c.channelId,
      actorId: ctx.userId,
      kind: "system",
      body: `added ${names.join(", ")}`,
    });
  return { added: added.length };
}

async function describeMembers(
  tx: Tx,
  added: { userId: string | null; agentId: string | null }[],
  agents: { id: string; handle: string }[],
) {
  const userIds = added.flatMap((a) => (a.userId ? [a.userId] : []));
  const users = userIds.length
    ? await tx
        .select({ id: s.user.id, name: s.user.name })
        .from(s.user)
        .where(inArray(s.user.id, userIds))
    : [];
  return added.map((a) =>
    a.userId
      ? `@[${users.find((u) => u.id === a.userId)?.name.replace(/[[\]\n]/g, "") ?? "member"}](mention:${a.userId})`
      : `@[${agents.find((g) => g.id === a.agentId)?.handle ?? "agent"}](agent:${a.agentId})`,
  );
}

async function removeMember(
  tx: Tx,
  ctx: Context,
  c: Extract<ChannelCommand, { type: "removeChannelMember" }>,
) {
  if (!c.userId === !c.agentId)
    throw new DomainError(
      "validation",
      "Name one person (`userId`) or one agent (`agentId`).",
    );
  if (c.userId === ctx.userId) return leave(tx, ctx, c.channelId);
  const access = await accessOf(tx, ctx, c.channelId);
  requireManage(access);
  const removed = await tx
    .delete(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, c.channelId),
        c.userId
          ? eq(s.channelMember.userId, c.userId)
          : eq(s.channelMember.agentId, c.agentId!),
      ),
    )
    .returning({ id: s.channelMember.id });
  if (!removed.length) return undefined;
  if (access.channel.kind === "private")
    await recordAuditEvent(tx, {
      organizationId: ctx.organizationId,
      actor: { id: ctx.userId },
      action: "channel.member_removed",
      target: { type: "channel", id: c.channelId, label: label(access) },
      detail: c.userId ? { userId: c.userId } : { agentId: c.agentId },
    });
  return undefined;
}
