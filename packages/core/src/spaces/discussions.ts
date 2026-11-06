import { and, asc, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  spaceLevelAtLeast,
  type PageDiscussionCommand,
  type PageThreadAnchor,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { mentionedUserIds } from "@lictory/core/notifications/mentions";
import { pageAccess, type SpaceActor } from "@lictory/core/spaces/access";
import type {
  SpaceCommandContext,
  SpaceCommandSummary,
} from "@lictory/core/spaces/commands";
import {
  messageExcerpt,
  notifyPage,
  type PageNotice,
} from "@lictory/core/spaces/notifications";
import { writeSpaceProjections } from "@lictory/core/spaces/projections";

// Discussions on pages (docs/internals/spaces.md#comments), applied by
// `applySpaceCommand` inside `applyMutation`'s transaction. They follow the
// rules of specification threads: whoever may comment on the page (comment
// or edit access to an active space and page) starts and answers threads,
// resolves and reopens them and marks them blocking or not; messages are
// never edited or deleted, and resolving keeps the whole thread. Discussion
// events are recorded in `page_activity`; notifications go to people who
// can read the space (mentions, replies to participants, blocking threads
// to the page's writers).

const unavailablePage = () =>
  new DomainError("not_found", "This page is unavailable.");
const unavailableThread = () =>
  new DomainError("not_found", "This discussion is unavailable.");

// The page as a commenter may see it: people without access get not found
// (restricted spaces do not reveal themselves); readers learn why not.
async function requireCommenter(
  tx: Tx,
  actor: SpaceActor,
  pageId: string,
  unavailable = unavailablePage,
) {
  const row = await pageAccess(tx, actor, pageId);
  if (!row?.level) throw unavailable();
  if (!spaceLevelAtLeast(row.level, "comment"))
    throw new DomainError(
      "forbidden",
      `You can view ${row.space.name} but not comment on it. Ask one of its administrators for comment access.`,
    );
  if (row.space.archivedAt)
    throw new DomainError(
      "conflict",
      `${row.space.name} is archived. Restore it before discussing its pages.`,
    );
  if (row.page.archivedAt)
    throw new DomainError(
      "conflict",
      "This page is archived. Restore it before discussing it.",
    );
  return row;
}

async function threadOf(tx: Tx, actor: SpaceActor, threadId: string) {
  const [thread] = await tx
    .select()
    .from(s.pageThread)
    .where(
      and(
        eq(s.pageThread.organizationId, actor.organizationId),
        eq(s.pageThread.id, threadId),
      ),
    );
  if (!thread) throw unavailableThread();
  await requireCommenter(tx, actor, thread.pageId, unavailableThread);
  return thread;
}

// Checks that what an anchor references belongs to the page: the commit of
// a commit anchor, the open draft epoch of a draft anchor (whose branch
// becomes the thread's line). Positions are never resolved here.
async function anchorReferences(
  tx: Tx,
  organizationId: string,
  pageId: string,
  anchor: PageThreadAnchor,
  branchId: string | undefined,
) {
  if (branchId) {
    const [branch] = await tx
      .select({ deletedAt: s.pageBranch.deletedAt })
      .from(s.pageBranch)
      .where(
        and(
          eq(s.pageBranch.organizationId, organizationId),
          eq(s.pageBranch.pageId, pageId),
          eq(s.pageBranch.id, branchId),
        ),
      );
    if (!branch)
      throw new DomainError(
        "not_found",
        "This branch is unavailable on this page.",
      );
    if (branch.deletedAt)
      throw new DomainError(
        "conflict",
        "This branch was deleted. Comment on a version of the page instead.",
      );
  }
  switch (anchor.kind) {
    case "page":
      return { commitId: null, branchId: branchId ?? null };
    case "commit": {
      const [commit] = await tx
        .select({ id: s.pageCommit.id })
        .from(s.pageCommit)
        .where(
          and(
            eq(s.pageCommit.organizationId, organizationId),
            eq(s.pageCommit.pageId, pageId),
            eq(s.pageCommit.id, anchor.commitId),
          ),
        );
      if (!commit)
        throw new DomainError(
          "not_found",
          "This version of the page is unavailable.",
        );
      return { commitId: commit.id, branchId: branchId ?? null };
    }
    case "draft": {
      const [draft] = await tx
        .select({
          branchId: s.spaceDraft.branchId,
          epoch: s.spaceDraft.epoch,
          fencedAt: s.spaceDraft.fencedAt,
        })
        .from(s.spaceDraft)
        .where(
          and(
            eq(s.spaceDraft.organizationId, organizationId),
            eq(s.spaceDraft.pageId, pageId),
            eq(s.spaceDraft.id, anchor.draftId),
          ),
        );
      if (!draft)
        throw new DomainError(
          "not_found",
          "This draft is unavailable on this page.",
        );
      if (draft.fencedAt)
        throw new DomainError(
          "conflict",
          "This draft was closed. Comment on a version of the page instead.",
        );
      if (draft.epoch !== anchor.epoch)
        throw new DomainError(
          "conflict",
          "This draft was replaced after the text was selected. Select the text again and retry.",
        );
      if (branchId && branchId !== draft.branchId)
        throw new DomainError(
          "validation",
          "A draft discussion belongs to the draft's own branch.",
        );
      return { commitId: null, branchId: draft.branchId };
    }
  }
}

async function requireNewIds(
  tx: Tx,
  threadId: string | null,
  messageId: string,
) {
  const [thread] = threadId
    ? await tx
        .select({ id: s.pageThread.id })
        .from(s.pageThread)
        .where(eq(s.pageThread.id, threadId))
    : [];
  const [message] = await tx
    .select({ id: s.pageThreadMessage.id })
    .from(s.pageThreadMessage)
    .where(eq(s.pageThreadMessage.id, messageId));
  if (thread || message)
    throw new DomainError(
      "conflict",
      `This ${thread ? "discussion" : "message"} id is already used. Retry with a new id.`,
    );
}

// Everyone who wrote the page: authors and contributors of its commits.
async function pageWriters(tx: Tx, organizationId: string, pageId: string) {
  const commits = await tx
    .select({
      authorId: s.pageCommit.authorId,
      contributorIds: s.pageCommit.contributorIds,
    })
    .from(s.pageCommit)
    .where(
      and(
        eq(s.pageCommit.organizationId, organizationId),
        eq(s.pageCommit.pageId, pageId),
      ),
    );
  return new Set(commits.flatMap((c) => [c.authorId, ...c.contributorIds]));
}

async function participants(tx: Tx, organizationId: string, threadId: string) {
  const messages = await tx
    .select({ authorId: s.pageThreadMessage.authorId })
    .from(s.pageThreadMessage)
    .where(
      and(
        eq(s.pageThreadMessage.organizationId, organizationId),
        eq(s.pageThreadMessage.threadId, threadId),
      ),
    );
  return messages.map((m) => m.authorId);
}

export async function applyPageDiscussionCommand(
  tx: Tx,
  ctx: SpaceCommandContext,
  c: PageDiscussionCommand,
): Promise<SpaceCommandSummary | undefined> {
  const { organizationId, userId } = ctx;
  const actor: SpaceActor = { organizationId, userId };
  const now = new Date();
  const record = (
    pageId: string,
    action: string,
    detail: Record<string, unknown>,
  ) =>
    tx.insert(s.pageActivity).values({
      organizationId,
      pageId,
      actorId: userId,
      action,
      detail: { ...detail, ...ctx.delegation },
    });
  const notify = (pageId: string, notices: PageNotice[]) =>
    notifyPage(tx, { organizationId, pageId, actorId: userId, notices });
  const mentions = (body: string, threadId: string): PageNotice => ({
    userIds: mentionedUserIds(body),
    kind: "page_mentioned",
    detail: { threadId, excerpt: messageExcerpt(body), group: "message" },
  });
  const project = (pageId: string, counters: boolean) =>
    writeSpaceProjections(tx, organizationId, {
      ...(counters ? { pages: [pageId] } : {}),
      pageDiscussions: [pageId],
    });

  switch (c.type) {
    case "createPageThread": {
      const { page } = await requireCommenter(tx, actor, c.pageId);
      await requireNewIds(tx, c.threadId, c.messageId);
      const line = await anchorReferences(
        tx,
        organizationId,
        page.id,
        c.anchor,
        c.branchId,
      );
      const blocking = c.blocking ?? false;
      await tx.insert(s.pageThread).values({
        id: c.threadId,
        organizationId,
        pageId: page.id,
        authorId: userId,
        blocking,
        anchor: c.anchor,
        ...line,
      });
      await tx.insert(s.pageThreadMessage).values({
        id: c.messageId,
        organizationId,
        threadId: c.threadId,
        authorId: userId,
        body: c.body,
      });
      await record(page.id, "thread_opened", {
        threadId: c.threadId,
        blocking,
        anchor: c.anchor.kind,
      });
      await notify(page.id, [
        mentions(c.body, c.threadId),
        ...(blocking
          ? [
              {
                userIds: await pageWriters(tx, organizationId, page.id),
                kind: "page_blocking_thread" as const,
                detail: {
                  threadId: c.threadId,
                  excerpt: messageExcerpt(c.body),
                  group: "message",
                },
              },
            ]
          : []),
      ]);
      await project(page.id, true);
      return { threadId: c.threadId, messageId: c.messageId };
    }

    case "replyToPageThread": {
      const thread = await threadOf(tx, actor, c.threadId);
      await requireNewIds(tx, null, c.messageId);
      const before = await participants(tx, organizationId, thread.id);
      await tx.insert(s.pageThreadMessage).values({
        id: c.messageId,
        organizationId,
        threadId: thread.id,
        authorId: userId,
        body: c.body,
      });
      // Messages record no activity (as on specifications): the message
      // itself is the record.
      await notify(thread.pageId, [
        mentions(c.body, thread.id),
        {
          userIds: [thread.authorId, ...before],
          kind: "page_thread_reply",
          detail: {
            threadId: thread.id,
            excerpt: messageExcerpt(c.body),
            group: "message",
          },
        },
      ]);
      await project(thread.pageId, false);
      return { messageId: c.messageId };
    }

    case "resolvePageThread":
    case "reopenPageThread": {
      const thread = await threadOf(tx, actor, c.threadId);
      const resolved = c.type === "resolvePageThread";
      if ((thread.status === "resolved") === resolved) return undefined;
      await tx
        .update(s.pageThread)
        .set({
          status: resolved ? "resolved" : "open",
          resolvedById: resolved ? userId : null,
          resolvedAt: resolved ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.pageThread.organizationId, organizationId),
            eq(s.pageThread.id, thread.id),
          ),
        );
      await record(
        thread.pageId,
        resolved ? "thread_resolved" : "thread_reopened",
        { threadId: thread.id },
      );
      await project(thread.pageId, true);
      return undefined;
    }

    case "setPageThreadBlocking": {
      const thread = await threadOf(tx, actor, c.threadId);
      if (thread.blocking === c.blocking) return undefined;
      await tx
        .update(s.pageThread)
        .set({ blocking: c.blocking, updatedAt: now })
        .where(
          and(
            eq(s.pageThread.organizationId, organizationId),
            eq(s.pageThread.id, thread.id),
          ),
        );
      await record(thread.pageId, "thread_blocking_changed", {
        threadId: thread.id,
        blocking: c.blocking,
      });
      if (c.blocking && thread.status === "open")
        await notify(thread.pageId, [
          {
            userIds: await pageWriters(tx, organizationId, thread.pageId),
            kind: "page_blocking_thread",
            detail: { threadId: thread.id, marked: true },
          },
        ]);
      await project(thread.pageId, true);
      return undefined;
    }
  }
}

// ------------------------------------------------------------------ reads

// Open blocking threads of a page, in the caller's transaction: what a
// merge of the page's changes must refuse while any remains (each with the
// line and pull request it was written on, for the merge to choose).
export async function openBlockingPageThreads(
  tx: Database | Tx,
  organizationId: string,
  pageId: string,
) {
  return tx
    .select({
      id: s.pageThread.id,
      branchId: s.pageThread.branchId,
      pullRequestId: s.pageThread.pullRequestId,
    })
    .from(s.pageThread)
    .where(
      and(
        eq(s.pageThread.organizationId, organizationId),
        eq(s.pageThread.pageId, pageId),
        eq(s.pageThread.status, "open"),
        eq(s.pageThread.blocking, true),
      ),
    )
    .orderBy(asc(s.pageThread.createdAt), asc(s.pageThread.id));
}

const readOnly = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

export type PageThreadSummary = {
  id: string;
  status: "open" | "resolved";
  blocking: boolean;
  anchor: PageThreadAnchor;
  commitId: string | null;
  branchId: string | null;
  pullRequestId: string | null;
  authorId: string;
  createdAt: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  messages: {
    id: string;
    authorId: string;
    body: string;
    createdAt: string;
  }[];
};

// A page's discussions with their messages, oldest first, for readers of
// its space (MCP, Litto, browser routes). Resolved threads are left out
// unless asked for.
export async function listPageThreads(
  db: Database,
  userId: string,
  organizationId: string,
  pageId: string,
  options: { includeResolved?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    await authorize(tx, userId, organizationId);
    const found = await pageAccess(tx, { organizationId, userId }, pageId);
    if (!found?.level) throw unavailablePage();
    const threads = await tx
      .select()
      .from(s.pageThread)
      .where(
        and(
          eq(s.pageThread.organizationId, organizationId),
          eq(s.pageThread.pageId, pageId),
          options.includeResolved ? undefined : eq(s.pageThread.status, "open"),
        ),
      )
      .orderBy(asc(s.pageThread.createdAt), asc(s.pageThread.id));
    const messages = threads.length
      ? await tx
          .select()
          .from(s.pageThreadMessage)
          .where(
            and(
              eq(s.pageThreadMessage.organizationId, organizationId),
              inArray(
                s.pageThreadMessage.threadId,
                threads.map((t) => t.id),
              ),
            ),
          )
          .orderBy(
            asc(s.pageThreadMessage.createdAt),
            asc(s.pageThreadMessage.id),
          )
      : [];
    const result: PageThreadSummary[] = threads.map((t) => ({
      id: t.id,
      status: t.status,
      blocking: t.blocking,
      anchor: t.anchor as PageThreadAnchor,
      commitId: t.commitId,
      branchId: t.branchId,
      pullRequestId: t.pullRequestId,
      authorId: t.authorId,
      createdAt: t.createdAt.toISOString(),
      resolvedById: t.resolvedById,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      messages: messages
        .filter((m) => m.threadId === t.id)
        .map((m) => ({
          id: m.id,
          authorId: m.authorId,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
    }));
    return {
      page: { id: found.page.id, spaceId: found.space.id },
      level: found.level,
      threads: result,
    };
  }, readOnly);
}
