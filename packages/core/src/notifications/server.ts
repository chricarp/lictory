import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import {
  iterationLabel,
  type Command,
  type Directory,
  type Entity,
  type EntityOf,
} from "@lictory/core/contracts/protocol";
import type { NotificationKind } from "@lictory/core/notifications/catalog";
import {
  queueNotifications,
  type NotificationNotice,
} from "@lictory/core/notifications/events";
import {
  mentionedUserIds,
  stripMentions,
} from "@lictory/core/notifications/mentions";

type ItemContext = {
  organizationId: string;
  projectId: string;
  projectKey: string;
  workItemId: string;
  actorId: string;
  // Absent for automatic follow-ups that no person's command caused.
  command?: Command;
  activities: { action: string; detail?: Record<string, unknown> }[];
  after: Entity[];
  roster: Directory;
};

// Derives notifications from the activity a work-item command logged plus the
// resulting item scope, and queues them. Runs inside the mutation transaction
// and reads nothing: explicit watch state is applied when the event is fanned
// out.
export async function notifyItemActivity(tx: Tx, ctx: ItemContext) {
  const { after, roster, actorId, command: c } = ctx;
  const item = after.find(
    (e): e is EntityOf<"workItem"> =>
      e.type === "workItem" && e.id === ctx.workItemId,
  );
  if (!item) return;
  const of = <T extends Entity["type"]>(type: T) =>
    after.filter((e): e is EntityOf<T> => e.type === type);
  const threads = of("thread");
  const messages = of("message");
  const reviews = of("review");
  const assignments = of("assignment");
  const suggestions = of("suggestion");
  const pullRequests = of("pullRequest"),
    prReviews = of("prReview"),
    branches = of("specBranch");
  const suggestionReviewers = of("suggestionReviewer").filter(
    (r) => !r.withdrawnAt,
  );
  const disciplineMembers = (disciplineId: string | null) =>
    roster.disciplines.find((d) => d.id === disciplineId && !d.archivedAt)
      ?.userIds ?? [];
  const reviewTargets = (reviewId: string) =>
    assignments
      .filter((a) => a.reviewId === reviewId && !a.withdrawnAt)
      .flatMap((a) =>
        a.userId ? [a.userId] : disciplineMembers(a.disciplineId),
      );
  // Children materialized from a reviewed breakdown record whoever merged it
  // as their creator; that person follows the parent specification and does
  // not own each child. Their owners are the assignee and explicit watchers
  // (added at fan-out: `followers`).
  const owners = () =>
    [item.sourceRevisionId ? null : item.createdById, item.assigneeId].filter(
      (u): u is string => !!u,
    );
  const involved = () => [
    ...owners(),
    ...reviews
      .filter((r) => r.status !== "cancelled")
      .flatMap((r) => [r.requestedById, ...directReviewers(r.id)]),
    ...threads.map((t) => t.authorId),
    ...messages.map((m) => m.authorId),
    ...suggestions.map((x) => x.authorId),
    ...pullRequests.map((p) => p.authorId),
    ...branches.flatMap((b) => b.collaboratorIds),
    ...suggestionReviewers.map((r) => r.userId),
  ];
  // Role-targeted reviews notify role members when requested, but only
  // people named directly count as involved in every later event.
  const directReviewers = (reviewId: string) =>
    assignments
      .filter((a) => a.reviewId === reviewId && !a.withdrawnAt && a.userId)
      .map((a) => a.userId!);
  const threadParticipants = (threadId: string) => [
    ...threads.filter((t) => t.id === threadId).map((t) => t.authorId),
    ...messages.filter((m) => m.threadId === threadId).map((m) => m.authorId),
  ];
  const itemKey = `${ctx.projectKey}-${item.number}`;
  const base = {
    actorId,
    projectId: ctx.projectId,
    teamId: item.teamId,
    workItemId: item.id,
  };
  const notices: NotificationNotice[] = [];
  const add = (
    users: Iterable<string>,
    kind: NotificationKind,
    detail: Record<string, unknown> = {},
    options: { direct?: boolean; watchers?: boolean } = {},
  ) => {
    notices.push({
      ...base,
      userIds: users,
      kind,
      detail: { itemKey, title: item.title, ...detail },
      watchers: options.watchers,
      // Opting out of an item silences ambient updates, never requests that
      // are addressed to the person (review requests, mentions, assignment).
      skipUnwatched: !options.direct,
    });
  };
  const direct = { direct: true };
  // Everyone involved in or owning the item, plus its explicit watchers.
  const followers = { watchers: true };
  const excerpt = (body: string) => {
    const text = stripMentions(body).replace(/\s+/g, " ").trim();
    return text.length > 280 ? `${text.slice(0, 277)}…` : text;
  };
  const mentions = (body: string, threadId: string) => {
    const ids = mentionedUserIds(body);
    add(
      ids,
      "mentioned",
      { threadId, excerpt: excerpt(body), group: "message" },
      direct,
    );
  };

  // Messages have no activity entry; the command tells us what was said.
  if (c?.type === "replyToThread") {
    const thread = threads.find((t) => t.id === c.threadId);
    mentions(c.body, c.threadId);
    add(threadParticipants(c.threadId), "thread_reply", {
      threadId: c.threadId,
      excerpt: excerpt(c.body),
      section: thread?.anchor?.section ?? null,
      group: "message",
    });
  }

  for (const { action, detail = {} } of ctx.activities) {
    switch (action) {
      case "created":
        if (item.assigneeId) add([item.assigneeId], "assigned", {}, direct);
        break;
      case "assignee_changed":
        if (typeof detail.to === "string")
          add([detail.to], "assigned", {}, direct);
        break;
      case "status_changed":
        add(
          involved(),
          "status_changed",
          { from: detail.from, to: detail.to, category: detail.category },
          followers,
        );
        break;
      case "archived":
      case "restored":
        add(
          involved(),
          "item_archived",
          { archived: action === "archived" },
          followers,
        );
        break;
      case "relation_added":
        if (detail.kind === "blocks" && typeof detail.toId === "string")
          await notifyBlocked(tx, ctx, detail.toId, itemKey);
        break;
      case "revised": {
        const number = detail.number as number;
        const stale = of("approval").filter(
          (a) =>
            a.status === "stale" &&
            a.endReason === `Specification revised (revision ${number})`,
        );
        add(
          stale.map((a) => a.reviewerId),
          "approval_invalidated",
          { revision: number, group: "revision" },
          direct,
        );
        add(
          involved(),
          "specification_revised",
          {
            revision: number,
            summary: detail.summary ?? null,
            group: "revision",
          },
          followers,
        );
        break;
      }
      case "refinement_changed":
        if (detail.to === "ready") add(involved(), "item_ready", {}, followers);
        else if (detail.from === "ready")
          add(involved(), "item_unready", {}, followers);
        break;
      case "review_requested": {
        const reviewId = detail.reviewId as string;
        add(
          reviewTargets(reviewId),
          "review_requested",
          {
            reviewId,
            responsibility: detail.responsibility,
            required: detail.required,
            revision: item.revisionNumber,
          },
          direct,
        );
        break;
      }
      case "review_cancelled":
        add(reviewTargets(detail.reviewId as string), "review_cancelled", {
          responsibility: detail.responsibility,
        });
        break;
      case "approved":
      case "changes_requested":
      case "approval_revoked": {
        const review = reviews.find((r) => r.id === detail.reviewId);
        add(
          [...owners(), ...(review ? [review.requestedById] : [])],
          "review_decided",
          {
            decision: action,
            responsibility: detail.responsibility,
            revision: detail.revision,
          },
          followers,
        );
        break;
      }
      case "thread_opened": {
        const threadId = detail.threadId as string;
        const first = messages.find((m) => m.threadId === threadId);
        const thread = threads.find((t) => t.id === threadId);
        const context = {
          threadId,
          ...(thread?.pullRequestId
            ? { pullRequestId: thread.pullRequestId }
            : {}),
          excerpt: first ? excerpt(first.body) : "",
          section: thread?.anchor?.section ?? null,
          blocking: detail.blocking,
          group: "message",
        };
        if (first) mentions(first.body, threadId);
        add(
          involved(),
          detail.blocking ? "blocking_thread" : "thread_opened",
          context,
          followers,
        );
        break;
      }
      case "thread_blocking_changed":
        if (detail.blocking)
          add(
            involved(),
            "blocking_thread",
            { threadId: detail.threadId, marked: true },
            followers,
          );
        break;
      case "thread_resolved":
      case "thread_reopened":
        add(threadParticipants(detail.threadId as string), "thread_resolved", {
          threadId: detail.threadId,
          resolved: action === "thread_resolved",
        });
        break;
      case "pull_request_created":
      case "pull_request_draft_changed":
      case "pull_request_review_requested": {
        const pr = pullRequests.find((p) => p.id === detail.pullRequestId);
        if (pr?.status !== "open") break;
        const requested = prReviews.filter(
          (r) =>
            r.pullRequestId === pr.id &&
            (action !== "pull_request_review_requested" ||
              r.disciplineId === detail.disciplineId),
        );
        for (const r of requested)
          add(
            r.userId ? [r.userId] : disciplineMembers(r.disciplineId),
            "pull_request_review_requested",
            {
              pullRequestId: pr.id,
              pullRequestTitle: pr.title,
              responsibility: roster.disciplines.find(
                (d) => d.id === r.disciplineId,
              )?.name,
            },
            direct,
          );
        break;
      }
      case "pull_request_review_decided": {
        const pr = pullRequests.find((p) => p.id === detail.pullRequestId);
        if (pr)
          add(
            [
              pr.authorId,
              ...(branches.find((b) => b.id === pr.sourceId)?.collaboratorIds ??
                []),
            ],
            "pull_request_decided",
            {
              pullRequestId: pr.id,
              pullRequestTitle: pr.title,
              decision: detail.decision,
              responsibility: detail.discipline ?? detail.role,
            },
          );
        break;
      }
      case "pull_request_ready_to_merge": {
        const pr = pullRequests.find((p) => p.id === detail.pullRequestId);
        if (pr?.status === "open")
          add(
            [
              pr.authorId,
              ...(branches.find((b) => b.id === pr.sourceId)?.collaboratorIds ??
                []),
            ],
            "pull_request_mergeable",
            {
              pullRequestId: pr.id,
              pullRequestTitle: pr.title,
              target: branches.find((b) => b.id === pr.targetId)?.name ?? null,
            },
          );
        break;
      }
      case "pull_request_merged": {
        const pr = pullRequests.find((p) => p.id === detail.pullRequestId);
        if (pr)
          add(
            [
              pr.authorId,
              ...(branches.find((b) => b.id === pr.sourceId)?.collaboratorIds ??
                []),
              ...prReviews
                .filter((r) => r.pullRequestId === pr.id)
                .flatMap((r) => (r.reviewerId ? [r.reviewerId] : [])),
            ],
            "pull_request_merged",
            {
              pullRequestId: pr.id,
              pullRequestTitle: pr.title,
              target: detail.target,
            },
          );
        break;
      }
      case "pull_request_approval_invalidated":
        add(
          Array.isArray(detail.reviewerIds)
            ? (detail.reviewerIds as string[])
            : [],
          "approval_invalidated",
          {
            pullRequestId: detail.pullRequestId,
            pullRequestTitle: detail.title,
          },
          direct,
        );
        break;
      case "suggestion_reviewer_assigned":
        add(
          [detail.userId as string],
          "suggestion_review_requested",
          {
            suggestionId: detail.suggestionId,
            suggestionTitle: suggestionTitle(detail.suggestionId),
          },
          direct,
        );
        break;
      case "suggestion_approved":
      case "suggestion_changes_requested":
        add([detail.authorId as string], "suggestion_decided", {
          suggestionId: detail.suggestionId,
          suggestionTitle: suggestionTitle(detail.suggestionId),
          decision:
            action === "suggestion_approved" ? "approved" : "changes_requested",
          version: detail.version,
        });
        break;
      case "suggestion_updated":
        add(
          suggestionReviewers
            .filter((r) => r.suggestionId === detail.suggestionId)
            .map((r) => r.userId),
          "suggestion_updated",
          {
            suggestionId: detail.suggestionId,
            suggestionTitle: suggestionTitle(detail.suggestionId),
            version: detail.version,
          },
        );
        break;
      case "suggestion_merged":
      case "suggestion_closed": {
        const id = detail.suggestionId as string;
        add(
          [
            detail.authorId as string,
            ...suggestionReviewers
              .filter((r) => r.suggestionId === id)
              .map((r) => r.userId),
          ],
          "suggestion_merged",
          {
            suggestionId: id,
            suggestionTitle: suggestionTitle(id),
            merged: action === "suggestion_merged",
          },
        );
        break;
      }
    }
  }
  function suggestionTitle(id: unknown) {
    return suggestions.find((x) => x.id === id)?.title ?? null;
  }
  await queueNotifications(tx, ctx.organizationId, notices);
}

async function notifyBlocked(
  tx: Tx,
  ctx: ItemContext,
  blockedId: string,
  blockerKey: string,
) {
  const [target] = await tx
    .select({
      id: s.workItem.id,
      number: s.workItem.number,
      title: s.workItem.title,
      projectId: s.workItem.projectId,
      teamId: s.workItem.teamId,
      createdById: s.workItem.createdById,
      assigneeId: s.workItem.assigneeId,
      key: s.project.key,
    })
    .from(s.workItem)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, ctx.organizationId),
        eq(s.workItem.id, blockedId),
      ),
    );
  if (!target) return;
  await queueNotifications(tx, ctx.organizationId, [
    {
      userIds: [target.createdById, target.assigneeId].filter(
        (u): u is string => !!u,
      ),
      kind: "relation_blocked",
      actorId: ctx.actorId,
      projectId: target.projectId,
      teamId: target.teamId,
      workItemId: target.id,
      detail: {
        itemKey: `${target.key}-${target.number}`,
        title: target.title,
        blockerKey,
        blockerId: ctx.workItemId,
      },
      watchers: true,
      skipUnwatched: true,
    },
  ]);
}

// Iterations belong to a project; its members are the audience.
export async function notifyIteration(
  tx: Tx,
  input: {
    organizationId: string;
    iterationId: string;
    kind: "iteration_started" | "iteration_completed";
    actorId: string | null;
  },
) {
  const [it] = await tx
    .select()
    .from(s.iteration)
    .where(
      and(
        eq(s.iteration.organizationId, input.organizationId),
        eq(s.iteration.id, input.iterationId),
      ),
    );
  if (!it) return;
  const [project] = await tx
    .select({
      name: s.project.name,
      key: s.project.key,
      iterationMode: s.project.iterationMode,
    })
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, input.organizationId),
        eq(s.project.id, it.projectId),
      ),
    );
  const members = await tx
    .select({ userId: s.projectMember.userId })
    .from(s.projectMember)
    .where(
      and(
        eq(s.projectMember.organizationId, input.organizationId),
        eq(s.projectMember.projectId, it.projectId),
      ),
    );
  const summary = it.summary;
  await queueNotifications(tx, input.organizationId, [
    {
      userIds: members.map((m) => m.userId),
      kind: input.kind,
      actorId: input.actorId,
      projectId: it.projectId,
      detail: {
        iterationId: it.id,
        iterationName: iterationLabel(it, project?.iterationMode),
        projectName: project?.name ?? null,
        projectKey: project?.key ?? null,
        ...(input.kind === "iteration_completed" && summary
          ? { carriedOver: summary.carriedOver ?? null }
          : {}),
      },
      // Automatic cycles may be advanced by overlapping workers.
      dedupeKey: `${input.kind}:${it.id}`,
    },
  ]);
}

// The requester learns how their export ended. Failures and conflicts carry
// the per-item messages so the notification is actionable on its own.
export async function notifyExport(
  tx: Tx,
  publication: typeof s.deliveryPublication.$inferSelect,
  status: "completed" | "partial" | "failed",
) {
  const results = Object.entries(publication.results);
  const failed = results.filter(
    ([, r]) => r.outcome === "failed" || r.outcome === "conflict",
  );
  const [project] = await tx
    .select({ key: s.project.key })
    .from(s.project)
    .where(
      and(
        eq(s.project.organizationId, publication.organizationId),
        eq(s.project.id, publication.projectId),
      ),
    );
  const [connection] = await tx
    .select({ name: s.deliveryConnection.name })
    .from(s.deliveryConnection)
    .where(
      and(
        eq(s.deliveryConnection.organizationId, publication.organizationId),
        eq(s.deliveryConnection.id, publication.connectionId),
      ),
    );
  let rootKey: string | null = null;
  let rootTitle: string | null = null;
  let teamId: string | null = null;
  if (publication.rootItemId) {
    const [root] = await tx
      .select({
        number: s.workItem.number,
        title: s.workItem.title,
        teamId: s.workItem.teamId,
      })
      .from(s.workItem)
      .where(
        and(
          eq(s.workItem.organizationId, publication.organizationId),
          eq(s.workItem.id, publication.rootItemId),
        ),
      );
    if (root) {
      rootKey = `${project?.key}-${root.number}`;
      rootTitle = root.title;
      teamId = root.teamId;
    }
  }
  await queueNotifications(tx, publication.organizationId, [
    {
      userIds: [publication.requestedById],
      kind: status === "completed" ? "export_completed" : "export_failed",
      // The requester is also the actor; exports report back to them.
      actorId: null,
      projectId: publication.projectId,
      teamId,
      workItemId: publication.rootItemId,
      detail: {
        publicationId: publication.id,
        status,
        connectionName: connection?.name ?? null,
        itemKey: rootKey,
        title: rootTitle,
        total: results.length,
        failed: failed.length,
        failures: failed.slice(0, 5).map(([id, r]) => ({
          workItemId: id,
          outcome: r.outcome,
          message: r.message ?? null,
        })),
      },
      dedupeKey: `export:${publication.id}`,
    },
  ]);
}
