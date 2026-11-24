import { defineMutator, defineMutators } from "@rocicorp/zero";
import "@lictory/zero/context";
import { optimistic, type Entities } from "@lictory/core/contracts/optimistic";
import {
  directoryKey,
  projectionRow,
  type DirectoryProjection,
} from "@lictory/core/contracts/projection";
import {
  isChannelCommand,
  isKnowledgeCommand,
  isSpaceCommand,
  mutationSchema,
  type Entity,
  type SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import {
  predictPageTree,
  predictsPageTree,
  type PredictedPageCommand,
} from "@lictory/core/spaces/optimistic";
import { zql, type Schema } from "@lictory/zero/schema";
import type { Transaction } from "@rocicorp/zero";
import {
  deleteMessageArgs,
  editMessageArgs,
  markReadArgs,
  reactArgs,
  sendMessageArgs,
  threadArgs,
} from "@lictory/core/channels/protocol";
import {
  REPLY_AUTHORS_MAX,
  participantKey,
  reactionId,
} from "@lictory/core/channels/shared";

// Every workspace command is one mutation of the existing domain protocol.
// The client run predicts safe changes with the shared optimistic reducers;
// commands that need authorization or exact bases (revisions, branches,
// suggestions, review decisions, merges) predict nothing and wait for the
// server. The API registers a server implementation under the same name that
// runs the domain command inside Zero's transaction.
export const mutators = defineMutators({
  // Lictory Channels' conversation writer (docs/internals/channels.md). The
  // client run predicts the message, reaction or cursor so the conversation
  // feels instant; the API runs the writer inside Zero's transaction and the
  // stored rows (same ids) replace the predictions. A refused write removes
  // its prediction. Sequences are predicted as "next"; the server assigns
  // the real one.
  channels: {
    send: defineMutator(sendMessageArgs, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.send.");
      const channel = await tx.run(
        zql.channel.where("id", args.channelId).one(),
      );
      if (!channel) return;
      const now = Date.now();
      const sequence = channel.lastSequence + 1;
      const root = args.threadRootId
        ? await tx.run(zql.channelMessage.where("id", args.threadRootId).one())
        : undefined;
      await tx.mutate.channelMessage.insert({
        id: args.messageId,
        organizationId: args.organizationId,
        channelId: args.channelId,
        sequence,
        threadRootId: root?.id ?? null,
        rootIndex: root ? null : channel.rootCount + 1,
        authorKind: "user",
        authorUserId: ctx.userID,
        authorAgentId: null,
        onBehalfOfUserId: null,
        via: null,
        kind: "message",
        body: args.body,
        payload: null,
        attachments: args.attachments ?? [],
        replyCount: 0,
        lastReplyAt: null,
        replyAuthors: [],
        editedAt: null,
        deletedAt: null,
        externalSource: null,
        createdAt: now,
      });
      await tx.mutate.channel.update({
        id: channel.id,
        lastSequence: sequence,
        rootCount: channel.rootCount + (root ? 0 : 1),
        lastMessageAt: now,
      });
      if (root) {
        const key = participantKey("user", ctx.userID);
        await tx.mutate.channelMessage.update({
          id: root.id,
          replyCount: root.replyCount + 1,
          lastReplyAt: now,
          replyAuthors: [
            key,
            ...root.replyAuthors.filter((k) => k !== key),
          ].slice(0, REPLY_AUTHORS_MAX),
        });
        return;
      }
      const member = await tx.run(
        zql.channelMember
          .where("channelId", args.channelId)
          .where("userId", ctx.userID)
          .one(),
      );
      if (member)
        await tx.mutate.channelMember.update({
          id: member.id,
          readSequence: sequence,
          readRootCount: channel.rootCount + 1,
          mentionCount: 0,
        });
    }),
    edit: defineMutator(editMessageArgs, async ({ tx, args }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.edit.");
      await tx.mutate.channelMessage.update({
        id: args.messageId,
        body: args.body,
        editedAt: Date.now(),
      });
    }),
    remove: defineMutator(deleteMessageArgs, async ({ tx, args }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.remove.");
      await tx.mutate.channelMessage.update({
        id: args.messageId,
        body: "",
        attachments: [],
        deletedAt: Date.now(),
      });
    }),
    react: defineMutator(reactArgs, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.react.");
      const id = reactionId(
        args.messageId,
        participantKey("user", ctx.userID),
        args.emoji,
      );
      if (!args.add) {
        await tx.mutate.channelReaction.delete({ id });
        return;
      }
      await tx.mutate.channelReaction.upsert({
        id,
        organizationId: args.organizationId,
        channelId: args.channelId,
        messageId: args.messageId,
        emoji: args.emoji,
        reactorKind: "user",
        userId: ctx.userID,
        agentId: null,
        createdAt: Date.now(),
      });
    }),
    markRead: defineMutator(markReadArgs, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.markRead.");
      const [channel, member] = await Promise.all([
        tx.run(zql.channel.where("id", args.channelId).one()),
        tx.run(
          zql.channelMember
            .where("channelId", args.channelId)
            .where("userId", ctx.userID)
            .one(),
        ),
      ]);
      if (!channel || !member) return;
      // Only the "everything read" position is predicted exactly; others
      // wait for the server's recount.
      if (!args.unread && args.sequence >= channel.lastSequence)
        await tx.mutate.channelMember.update({
          id: member.id,
          readSequence: channel.lastSequence,
          readRootCount: channel.rootCount,
          mentionCount: 0,
        });
    }),
    thread: defineMutator(threadArgs, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override channels.thread.");
      const [root, participant] = await Promise.all([
        tx.run(zql.channelMessage.where("id", args.rootMessageId).one()),
        tx.run(
          zql.channelThreadParticipant
            .where("rootMessageId", args.rootMessageId)
            .where("userId", ctx.userID)
            .one(),
        ),
      ]);
      if (!root || !participant) return;
      await tx.mutate.channelThreadParticipant.update({
        rootMessageId: root.id,
        userId: ctx.userID,
        ...(args.read ? { readReplyCount: root.replyCount } : {}),
        ...(args.following !== undefined ? { following: args.following } : {}),
      });
    }),
  },
  workspace: {
    apply: defineMutator(mutationSchema, async ({ tx, args, ctx }) => {
      if (tx.location === "server")
        throw new Error("The API must override workspace.apply.");
      const command = args.command;
      // Spaces commands never touch `sync_entity`. Page tree changes are
      // predicted on `space_entity`; access, publishing and every other
      // Spaces decision waits for the server.
      if (isSpaceCommand(command)) {
        if (predictsPageTree(command))
          await predictSpaceTree(tx, args.organizationId, command, ctx.userID);
        return;
      }
      // Knowledge links need the page's access checked by the server and
      // are projected with the page: nothing is predicted.
      if (isKnowledgeCommand(command)) return;
      // Channel structure and membership wait for the server (names must be
      // unique, access decides who may change what).
      if (isChannelCommand(command)) return;
      const workItemId =
        "workItemId" in command && typeof command.workItemId === "string"
          ? command.workItemId
          : undefined;
      const [listRows, itemRows] = await Promise.all([
        tx.run(
          zql.syncEntity
            .where("organizationId", args.organizationId)
            .where("workItemId", "IS", null),
        ),
        workItemId
          ? tx.run(
              zql.syncEntity
                .where("organizationId", args.organizationId)
                .where("workItemId", workItemId),
            )
          : Promise.resolve([]),
      ]);
      const directory = listRows.find(
        (row) => row.key === directoryKey(args.organizationId),
      )?.data as DirectoryProjection | undefined;
      const before: Entities = {};
      for (const row of [...listRows, ...itemRows])
        if (row.type !== "directory" && row.type !== "organizationProfile")
          before[row.key] = row.data as unknown as Entity;
      const disciplines = new Map(
        directory?.disciplines.map((d) => [d.id, d.name]) ?? [],
      );
      const after = optimistic(
        before,
        [args],
        ctx.userID,
        (id) => disciplines.get(id) ?? "Review",
        directory,
      );
      const scope = {
        projectId:
          "projectId" in command && typeof command.projectId === "string"
            ? command.projectId
            : ((before[`workItem:${workItemId}`] as { projectId?: string })
                ?.projectId ?? ""),
        workItemId,
      };
      const now = Date.now();
      for (const [key, entity] of Object.entries(after)) {
        if (before[key] === entity) continue;
        const row = projectionRow(entity, scope);
        await tx.mutate.syncEntity.upsert({
          ...row,
          data: row.data as Readonly<Record<string, never>>,
          updatedAt: now,
        });
      }
      for (const key of Object.keys(before))
        if (!(key in after)) await tx.mutate.syncEntity.delete({ key });
    }),
  },
});

async function predictSpaceTree(
  tx: Transaction<Schema>,
  organizationId: string,
  command: PredictedPageCommand,
  userId: string,
) {
  let spaceId: string | undefined;
  if (command.type === "createPage") spaceId = command.spaceId;
  else {
    const [row] = await tx.run(
      zql.spaceEntity
        .where("organizationId", organizationId)
        .where("key", `page:${command.pageId}`),
    );
    spaceId = row?.spaceId;
  }
  if (!spaceId) return;
  const rows = await tx.run(
    zql.spaceEntity
      .where("organizationId", organizationId)
      .where("spaceId", spaceId)
      .where("type", "page"),
  );
  const pages = rows.map((row) => row.data as unknown as SpaceEntityOf<"page">);
  const now = Date.now();
  for (const page of predictPageTree(pages, command, {
    organizationId,
    userId,
    now: new Date(now).toISOString(),
  }))
    await tx.mutate.spaceEntity.upsert({
      key: `page:${page.id}`,
      organizationId,
      spaceId: page.spaceId,
      pageId: null,
      type: "page",
      data: page,
      updatedAt: now,
    });
}
