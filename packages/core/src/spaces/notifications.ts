import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import type { NotificationKind } from "@lictory/core/notifications/catalog";
import { queueNotifications } from "@lictory/core/notifications/events";
import { stripMentions } from "@lictory/core/notifications/mentions";

// Notifications about pages (docs/internals/notifications.md). They use the
// shared machinery (queue, preferences, email outbox, realtime signal) and
// name their space and page, so the fan-out only writes them for current
// readers of the space and every later read (inbox, unread counts,
// email) checks that access again. Preferences resolve against the space's
// home: its team, then its project, then the organization.

export type PageNotificationKind = Extract<NotificationKind, `page_${string}`>;

export type PageNotice = {
  userIds: Iterable<string>;
  kind: PageNotificationKind;
  // Rendering context added to the page's (thread id, excerpt, pull
  // request id and title…). `group` makes notices of one event share a
  // slot per person, the first one winning.
  detail?: Record<string, unknown>;
};

// Plain-text excerpt of a message for inbox and email.
export function messageExcerpt(body: string) {
  const text = stripMentions(body).replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

// Queues the notices about one page in the caller's transaction (which holds
// the organization lock). Order notices most specific first: one event
// yields at most one notification per person and group.
export async function notifyPage(
  tx: Tx,
  input: {
    organizationId: string;
    pageId: string;
    actorId: string | null;
    notices: PageNotice[];
  },
) {
  const [context] = await tx
    .select({
      spaceId: s.space.id,
      spaceName: s.space.name,
      spaceSlug: s.space.slug,
      projectId: s.space.projectId,
      teamId: s.space.teamId,
      title: s.pageCommit.title,
    })
    .from(s.page)
    .innerJoin(
      s.space,
      and(
        eq(s.space.organizationId, s.page.organizationId),
        eq(s.space.id, s.page.spaceId),
      ),
    )
    .innerJoin(
      s.pageBranch,
      and(
        eq(s.pageBranch.organizationId, s.page.organizationId),
        eq(s.pageBranch.pageId, s.page.id),
        eq(s.pageBranch.isMain, true),
      ),
    )
    .innerJoin(
      s.pageCommit,
      and(
        eq(s.pageCommit.organizationId, s.pageBranch.organizationId),
        eq(s.pageCommit.pageId, s.pageBranch.pageId),
        eq(s.pageCommit.id, s.pageBranch.headCommitId),
      ),
    )
    .where(
      and(
        eq(s.page.organizationId, input.organizationId),
        eq(s.page.id, input.pageId),
      ),
    );
  if (!context) return;
  await queueNotifications(
    tx,
    input.organizationId,
    input.notices.map((notice) => ({
      userIds: notice.userIds,
      kind: notice.kind,
      actorId: input.actorId,
      projectId: context.projectId,
      teamId: context.teamId,
      spaceId: context.spaceId,
      pageId: input.pageId,
      detail: {
        spaceId: context.spaceId,
        spaceName: context.spaceName,
        spaceSlug: context.spaceSlug,
        pageId: input.pageId,
        pageTitle: context.title,
        ...notice.detail,
      },
    })),
  );
}

// Entry points for page reviews (pull requests on pages). Call them inside
// the command's transaction after the review rows are written. Reviewers
// who cannot read the space, or who are the actor, are skipped.

// Someone was asked to review a proposed change to a page.
export async function notifyPageReviewRequested(
  tx: Tx,
  input: {
    organizationId: string;
    pageId: string;
    actorId: string;
    reviewerIds: string[];
    pullRequestId: string;
    pullRequestTitle: string | null;
  },
) {
  return notifyPage(tx, {
    organizationId: input.organizationId,
    pageId: input.pageId,
    actorId: input.actorId,
    notices: [
      {
        userIds: input.reviewerIds,
        kind: "page_review_requested",
        detail: {
          pullRequestId: input.pullRequestId,
          pullRequestTitle: input.pullRequestTitle,
        },
      },
    ],
  });
}

// A change these reviewers approved changed, so their approval went stale.
export async function notifyPageApprovalInvalidated(
  tx: Tx,
  input: {
    organizationId: string;
    pageId: string;
    actorId: string | null;
    reviewerIds: string[];
    pullRequestId: string;
    pullRequestTitle: string | null;
  },
) {
  return notifyPage(tx, {
    organizationId: input.organizationId,
    pageId: input.pageId,
    actorId: input.actorId,
    notices: [
      {
        userIds: input.reviewerIds,
        kind: "page_approval_invalidated",
        detail: {
          pullRequestId: input.pullRequestId,
          pullRequestTitle: input.pullRequestTitle,
        },
      },
    ],
  });
}
