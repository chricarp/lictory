import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "../db/schema";
import type { Tx } from "../sync/server/service";
import type {
  Command,
  Directory,
  Entity,
  EntityOf,
} from "../sync/shared/protocol";
import {
  isNotificationKind,
  resolveChannels,
  type NotificationKind,
  type PreferenceRule,
} from "./catalog";
import { mentionedUserIds, stripMentions } from "./mentions";

export type NotificationDraft = {
  userId: string;
  kind: NotificationKind;
  actorId: string | null;
  projectId?: string | null;
  teamId?: string | null;
  workItemId?: string | null;
  detail?: Record<string, unknown>;
  dedupeKey?: string;
};

// Writes notifications (and queued emails) for drafts, in the caller's
// transaction. Recipients are filtered to current organization members and to
// their resolved preferences; the actor is never notified about their own
// action. When one event yields several drafts for the same person on the same
// item, only the first survives: callers order drafts most-specific first
// (a mention beats "new discussion" for the same message).
export async function deliverNotifications(
  tx: Tx,
  organizationId: string,
  drafts: NotificationDraft[],
) {
  const seen = new Set<string>();
  const unique = drafts.filter((d) => {
    if (d.actorId && d.userId === d.actorId) return false;
    const key = `${d.userId}:${d.workItemId ?? ""}:${typeof d.detail?.group === "string" ? d.detail.group : d.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!unique.length) return [];
  const userIds = [...new Set(unique.map((d) => d.userId))];
  const members = new Set(
    (
      await tx
        .select({ userId: s.member.userId })
        .from(s.member)
        .where(
          and(
            eq(s.member.organizationId, organizationId),
            inArray(s.member.userId, userIds),
          ),
        )
    ).map((m) => m.userId),
  );
  const rules = await tx
    .select()
    .from(s.notificationPreference)
    .where(
      and(
        eq(s.notificationPreference.organizationId, organizationId),
        inArray(s.notificationPreference.userId, userIds),
      ),
    );
  const rulesByUser = new Map<string, PreferenceRule[]>();
  for (const r of rules) {
    if (!isNotificationKind(r.kind)) continue;
    const list = rulesByUser.get(r.userId) ?? [];
    list.push({ ...r, kind: r.kind });
    rulesByUser.set(r.userId, list);
  }
  const rows: (typeof s.notification.$inferInsert)[] = [];
  const emailIds = new Set<string>();
  for (const d of unique) {
    if (!members.has(d.userId)) continue;
    const channels = resolveChannels(rulesByUser.get(d.userId) ?? [], d.kind, {
      organizationId,
      projectId: d.projectId,
      teamId: d.teamId,
    });
    if (!channels.inApp) continue;
    const id = crypto.randomUUID();
    const { group, ...detail } = d.detail ?? {};
    void group;
    rows.push({
      id,
      organizationId,
      userId: d.userId,
      kind: d.kind,
      actorId: d.actorId,
      projectId: d.projectId ?? null,
      teamId: d.teamId ?? null,
      workItemId: d.workItemId ?? null,
      detail,
      dedupeKey: d.dedupeKey ?? null,
    });
    if (channels.email) emailIds.add(id);
  }
  if (!rows.length) return [];
  const inserted = await tx
    .insert(s.notification)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: s.notification.id, userId: s.notification.userId });
  const emails = inserted.filter((r) => emailIds.has(r.id));
  if (emails.length)
    await tx.insert(s.notificationEmail).values(
      emails.map((r) => ({
        notificationId: r.id,
        organizationId,
        userId: r.userId,
      })),
    );
  // Delivered on commit; carries only who should refetch, never content.
  const recipients = [...new Set(inserted.map((r) => r.userId))];
  for (let i = 0; i < recipients.length; i += 100) {
    const payload = JSON.stringify({
      organizationId,
      userIds: recipients.slice(i, i + 100),
    });
    await tx.execute(sql`select pg_notify('lictory_notification', ${payload})`);
  }
  return inserted;
}

type ItemContext = {
  organizationId: string;
  projectId: string;
  projectKey: string;
  workItemId: string;
  actorId: string;
  command: Command;
  activities: { action: string; detail?: Record<string, unknown> }[];
  after: Entity[];
  roster: Directory;
};

// Derives notifications from the activity a work-item command logged plus the
// resulting item scope. Runs inside the mutation transaction.
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
  const suggestionReviewers = of("suggestionReviewer").filter(
    (r) => !r.withdrawnAt,
  );
  const watchRows = await tx
    .select()
    .from(s.workItemWatcher)
    .where(
      and(
        eq(s.workItemWatcher.organizationId, ctx.organizationId),
        eq(s.workItemWatcher.workItemId, item.id),
      ),
    );
  const unwatched = new Set(
    watchRows.filter((w) => !w.watching).map((w) => w.userId),
  );
  const watchers = watchRows.filter((w) => w.watching).map((w) => w.userId);
  const roleMembers = (roleId: string | null) =>
    roster.roles.find((r) => r.id === roleId && !r.archivedAt)?.userIds ?? [];
  const reviewTargets = (reviewId: string) =>
    assignments
      .filter((a) => a.reviewId === reviewId && !a.withdrawnAt)
      .flatMap((a) => (a.userId ? [a.userId] : roleMembers(a.roleId)));
  const owners = () =>
    [item.createdById, item.assigneeId, ...watchers].filter(
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
  const drafts: NotificationDraft[] = [];
  const add = (
    users: Iterable<string>,
    kind: NotificationKind,
    detail: Record<string, unknown> = {},
    options: { respectUnwatch?: boolean } = {},
  ) => {
    for (const userId of new Set(users)) {
      // Opting out of an item silences ambient updates, never requests that
      // are addressed to the person (review requests, mentions, assignment).
      if (options.respectUnwatch !== false && unwatched.has(userId)) continue;
      drafts.push({
        ...base,
        userId,
        kind,
        detail: { itemKey, title: item.title, ...detail },
      });
    }
  };
  const direct = { respectUnwatch: false };
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
  if (c.type === "replyToThread") {
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
        add(involved(), "status_changed", {
          from: detail.from,
          to: detail.to,
          category: detail.category,
        });
        break;
      case "archived":
      case "restored":
        add(involved(), "item_archived", { archived: action === "archived" });
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
        add(involved(), "specification_revised", {
          revision: number,
          summary: detail.summary ?? null,
          group: "revision",
        });
        break;
      }
      case "refinement_changed":
        if (detail.to === "ready") add(involved(), "item_ready");
        else if (detail.from === "ready") add(involved(), "item_unready");
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
        );
        break;
      }
      case "thread_opened": {
        const threadId = detail.threadId as string;
        const first = messages.find((m) => m.threadId === threadId);
        const thread = threads.find((t) => t.id === threadId);
        const context = {
          threadId,
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
        );
        break;
      }
      case "thread_blocking_changed":
        if (detail.blocking)
          add(involved(), "blocking_thread", {
            threadId: detail.threadId,
            marked: true,
          });
        break;
      case "thread_resolved":
      case "thread_reopened":
        add(threadParticipants(detail.threadId as string), "thread_resolved", {
          threadId: detail.threadId,
          resolved: action === "thread_resolved",
        });
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
  await deliverNotifications(tx, ctx.organizationId, drafts);
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
  const watchRows = await tx
    .select()
    .from(s.workItemWatcher)
    .where(
      and(
        eq(s.workItemWatcher.organizationId, ctx.organizationId),
        eq(s.workItemWatcher.workItemId, target.id),
      ),
    );
  const unwatched = new Set(
    watchRows.filter((w) => !w.watching).map((w) => w.userId),
  );
  const users = new Set(
    [
      target.createdById,
      target.assigneeId,
      ...watchRows.filter((w) => w.watching).map((w) => w.userId),
    ].filter((u): u is string => !!u && !unwatched.has(u)),
  );
  await deliverNotifications(
    tx,
    ctx.organizationId,
    [...users].map((userId) => ({
      userId,
      kind: "relation_blocked" as const,
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
    })),
  );
}

// Iterations belong to a team; its members are the audience.
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
  const [team] = await tx
    .select({ name: s.team.name })
    .from(s.team)
    .where(
      and(
        eq(s.team.organizationId, input.organizationId),
        eq(s.team.id, it.teamId),
      ),
    );
  const members = await tx
    .select({ userId: s.teamMember.userId })
    .from(s.teamMember)
    .where(
      and(
        eq(s.teamMember.organizationId, input.organizationId),
        eq(s.teamMember.teamId, it.teamId),
      ),
    );
  const summary = it.summary;
  await deliverNotifications(
    tx,
    input.organizationId,
    members.map((m) => ({
      userId: m.userId,
      kind: input.kind,
      actorId: input.actorId,
      teamId: it.teamId,
      detail: {
        iterationId: it.id,
        iterationName: it.name ?? `Iteration ${it.number}`,
        teamName: team?.name ?? null,
        ...(input.kind === "iteration_completed" && summary
          ? { carriedOver: summary.carriedOver ?? null }
          : {}),
      },
      // Automatic cycles may be advanced by overlapping workers.
      dedupeKey: `${input.kind}:${it.id}`,
    })),
  );
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
  await deliverNotifications(tx, publication.organizationId, [
    {
      userId: publication.requestedById,
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
