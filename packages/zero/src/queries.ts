import { defineQueries, defineQuery } from "@rocicorp/zero";
import { z } from "zod";
import { knowledgeEntityTypes } from "@lictory/core/contracts/protocol";
import "@lictory/zero/context";
import { zql } from "@lictory/zero/schema";

const organizationArgs = z.object({ organizationId: z.string().min(1) });
const pageArgs = z.object({
  organizationId: z.string().min(1),
  pageId: z.string().min(1),
});
const workItemArgs = z.object({
  organizationId: z.string().min(1),
  workItemId: z.string().min(1),
});
const projectArgs = z.object({
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
});
const knowledgeTypes = [...knowledgeEntityTypes];
const channelArgs = z.object({
  organizationId: z.string().min(1),
  channelId: z.string().min(1),
});

// Lictory Channels access (docs/internals/channels.md#access), evaluated
// against `ctx.userID` on every query: a public channel is readable by the
// organization's members, a private or direct one only by its members.
// Organization membership is required either way, so removing a member, or
// a person leaving a private channel, removes its rows from open
// subscriptions.
function readableChannel(q: typeof zql.channel, userID: string) {
  return q
    .where((eb) =>
      eb.or(
        eb.cmp("kind", "public"),
        eb.exists("members", (m) => m.where("userId", userID)),
      ),
    )
    .whereExists("orgMembers", (m) => m.where("userId", userID));
}

// Server-defined queries. Arguments only narrow; access always comes from the
// membership relationship evaluated against `ctx.userID`.
export const queries = defineQueries({
  // The organizations I belong to, with their public profile.
  memberships: defineQuery(({ ctx }) =>
    zql.member
      .where("userId", ctx.userID)
      .related("organization", (q) => q.where("type", "organizationProfile")),
  ),
  // Lists, boards, inbox and directory: organization-level projections only.
  organization: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", "IS", null)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One work item's history, loaded when the item is opened.
  workItem: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One work item's readiness checks alone, for a reference card naming
  // what is missing without loading the item's history.
  workItemReadiness: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.syncEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .where("type", "readiness")
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Lictory Spaces: every space I can read, with its grants and page tree
  // (space-level rows). Authorized by my effective access and my
  // organization membership; never part of the queries above.
  spaces: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", "IS", null)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One page's history (commits and branches), loaded when it is opened.
  page: defineQuery(pageArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", args.pageId)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // A space's review list needs proposal metadata, never every page's content.
  spacePullRequests: defineQuery(
    z.object({ organizationId: z.string().min(1), spaceId: z.string().min(1) }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("spaceId", args.spaceId)
        .where("type", "pagePullRequest")
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Knowledge links (docs/internals/knowledge-links.md). What pages say
  // about one work item: pages whose published version references it,
  // pages its specification revisions cite, attached pages, the page it was
  // created from and page branches proposed from it. Only rows of spaces I
  // read reach me, so nothing (not even a count) of other pages does.
  workItemKnowledge: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .where("type", "IN", knowledgeTypes)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // The work one page knows about (references, citations, attachments,
  // items created from it, branches proposed from items, context links),
  // without loading the page's history.
  pageWork: defineQuery(pageArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("pageId", args.pageId)
      .where("type", "IN", knowledgeTypes)
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Work items linked to the pages of one space (a space home's "Linked
  // work"): mentioned by their published versions, created from them,
  // attached to items or cited by specifications. Through the space's
  // readers.
  spaceWork: defineQuery(
    z.object({ organizationId: z.string().min(1), spaceId: z.string().min(1) }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("spaceId", args.spaceId)
        .where("type", "IN", [
          "pageReference",
          "workItemSource",
          "pageAttachment",
          "specificationCitation",
        ])
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Context pages of a project, its teams and its iterations that I can
  // read (`teamId` / `iterationId` in each row name the list).
  projectContext: defineQuery(projectArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("projectId", args.projectId)
      .where("type", "pageContextLink")
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Which work items readable pages mention, are attached to, are cited by
  // or were created from, for the "N pages" signal of item lists and
  // previews (the pages the item's Knowledge section shows): small rows,
  // and only of spaces I read.
  itemPageLinks: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("type", "IN", [
        "pageReference",
        "pageAttachment",
        "specificationCitation",
        "workItemSource",
      ])
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Inbox To do: page pull request metadata of the spaces I read (never page
  // content), from which my page reviews and my mergeable proposals derive.
  myPagePullRequests: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceEntity
      .where("organizationId", args.organizationId)
      .where("type", "pagePullRequest")
      .whereExists("readers", (r) => r.where("userId", ctx.userID))
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Review decisions on the named pages (those with an open pull request
  // that asks for my review), so a review I gave clears it from To do.
  pagePullRequestReviews: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      pageIds: z.array(z.string().min(1)).max(200),
    }),
    ({ args, ctx }) =>
      zql.spaceEntity
        .where("organizationId", args.organizationId)
        .where("pageId", "IN", args.pageIds)
        .where("type", "pagePullRequestReview")
        .whereExists("readers", (r) => r.where("userId", ctx.userID))
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // The Factory: agents and runners of the organization.
  factory: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.factoryEntity
      .where("organizationId", args.organizationId)
      .where("type", "IN", ["agent", "runner"])
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Agent session summaries, most recently updated first (a window).
  factorySessions: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      limit: z.number().int().min(1).max(500),
    }),
    ({ args, ctx }) =>
      zql.factoryEntity
        .where("organizationId", args.organizationId)
        .where("type", "session")
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .orderBy("updatedAt", "desc")
        .limit(args.limit),
  ),
  // One session's summary.
  factorySession: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      sessionId: z.string().min(1),
    }),
    ({ args, ctx }) =>
      zql.factoryEntity
        .where("organizationId", args.organizationId)
        .where("key", `session:${args.sessionId}`)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .one(),
  ),
  // The latest `limit` events of one session's log (newest first); the
  // transcript widens the window to read earlier events.
  factorySessionEvents: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      sessionId: z.string().min(1),
      limit: z.number().int().min(1).max(2000),
    }),
    ({ args, ctx }) =>
      zql.agentSessionEvent
        .where("organizationId", args.organizationId)
        .where("sessionId", args.sessionId)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .orderBy("sequence", "desc")
        .limit(args.limit),
  ),
  // My effective access level in each space I can read.
  mySpaceAccess: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.spaceReader
      .where("organizationId", args.organizationId)
      .where("userId", ctx.userID)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Lictory Channels. The channels I can read (public channels of the
  // organization and those I belong to), with nothing of their messages.
  channels: defineQuery(organizationArgs, ({ args, ctx }) =>
    readableChannel(
      zql.channel.where("organizationId", args.organizationId),
      ctx.userID,
    ),
  ),
  // My memberships with their read cursors, unread mentions and
  // notification levels: the sidebar's unread counts are arithmetic over
  // these and `channels`.
  myChannelMemberships: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.channelMember
      .where("organizationId", args.organizationId)
      .where("userId", ctx.userID)
      .whereExists("orgMembers", (m) => m.where("userId", ctx.userID)),
  ),
  // Who is in the direct conversations I belong to (to name them).
  directConversationMembers: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.channelMember
      .where("organizationId", args.organizationId)
      .whereExists("channel", (c) =>
        c
          .where("kind", "direct")
          .whereExists("members", (m) => m.where("userId", ctx.userID)),
      )
      .whereExists("orgMembers", (m) => m.where("userId", ctx.userID)),
  ),
  // The members of one channel I can read.
  channelMembers: defineQuery(channelArgs, ({ args, ctx }) =>
    zql.channelMember
      .where("organizationId", args.organizationId)
      .where("channelId", args.channelId)
      .whereExists("channel", (c) => readableChannel(c, ctx.userID)),
  ),
  // A window of a channel's top-level messages, newest first: the latest
  // `limit`, or (with `beforeSequence`) older history, or (with
  // `fromSequence`) the messages from an anchor on (jump to first unread,
  // a permalink). The list grows the window as people scroll.
  channelMessages: defineQuery(
    channelArgs.extend({
      limit: z.number().int().min(1).max(1000),
      beforeSequence: z.number().int().min(1).optional(),
      fromSequence: z.number().int().min(0).optional(),
    }),
    ({ args, ctx }) => {
      let q = zql.channelMessage
        .where("organizationId", args.organizationId)
        .where("channelId", args.channelId)
        .where("threadRootId", "IS", null);
      if (args.beforeSequence !== undefined)
        q = q.where("sequence", "<", args.beforeSequence);
      if (args.fromSequence !== undefined)
        q = q.where("sequence", ">=", args.fromSequence);
      return q
        .whereExists("channel", (c) => readableChannel(c, ctx.userID))
        .related("reactions")
        .orderBy("sequence", args.fromSequence !== undefined ? "asc" : "desc")
        .limit(args.limit);
    },
  ),
  // One thread: its first message and every reply, in order.
  channelThread: defineQuery(
    channelArgs.extend({ rootMessageId: z.string().min(1) }),
    ({ args, ctx }) =>
      zql.channelMessage
        .where("organizationId", args.organizationId)
        .where("channelId", args.channelId)
        .where((eb) =>
          eb.or(
            eb.cmp("id", args.rootMessageId),
            eb.cmp("threadRootId", args.rootMessageId),
          ),
        )
        .whereExists("channel", (c) => readableChannel(c, ctx.userID))
        .related("reactions")
        .orderBy("sequence", "asc"),
  ),
  // Threads I take part in or follow (my own rows only), and their first
  // messages, for thread unread counts and the Threads view.
  myChannelThreads: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.channelThreadParticipant
      .where("organizationId", args.organizationId)
      .where("userId", ctx.userID)
      .whereExists("channel", (c) => readableChannel(c, ctx.userID)),
  ),
  channelMessagesById: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      messageIds: z.array(z.string().min(1)).max(200),
    }),
    ({ args, ctx }) =>
      zql.channelMessage
        .where("organizationId", args.organizationId)
        .where("id", "IN", args.messageIds)
        .whereExists("channel", (c) => readableChannel(c, ctx.userID)),
  ),
  // Where a work item was promoted from, for its page: only conversations I
  // can read, so nobody learns a private channel discussed it.
  workItemConversations: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.channelPromotion
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .whereExists("channel", (c) => readableChannel(c, ctx.userID)),
  ),
  // Code (docs/internals/code-hosts.md#projections): connections,
  // repositories and my host logins, for settings, the Code page and every
  // item's Code panel.
  codeHosts: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.codeEntity
      .where("organizationId", args.organizationId)
      .where("type", "IN", ["codeConnection", "codeRepository", "codeIdentity"])
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Pull requests or issues in one state, most recently updated first.
  codeList: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      type: z.enum(["codePullRequest", "codeIssue"]),
      facet: z.enum(["open", "closed", "merged"]),
      limit: z.number().int().min(1).max(1000).default(500),
    }),
    ({ args, ctx }) =>
      zql.codeEntity
        .where("organizationId", args.organizationId)
        .where("type", args.type)
        .where("facet", args.facet)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .orderBy("updatedAt", "desc")
        .limit(args.limit),
  ),
  // One pull request.
  codePullRequest: defineQuery(
    z.object({
      organizationId: z.string().min(1),
      pullRequestId: z.string().min(1),
    }),
    ({ args, ctx }) =>
      zql.codeEntity
        .where("organizationId", args.organizationId)
        .where("key", `codePullRequest:${args.pullRequestId}`)
        .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // Writes Lictory queued for code hosts that have not succeeded yet.
  codeWrites: defineQuery(organizationArgs, ({ args, ctx }) =>
    zql.codeEntity
      .where("organizationId", args.organizationId)
      .where("type", "codeWrite")
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
  // One work item's Code panel: its links (with what they point at) and
  // the writes queued for it.
  workItemCode: defineQuery(workItemArgs, ({ args, ctx }) =>
    zql.codeEntity
      .where("organizationId", args.organizationId)
      .where("workItemId", args.workItemId)
      .whereExists("members", (m) => m.where("userId", ctx.userID)),
  ),
});
