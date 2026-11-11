import {
  entityKey,
  type Change,
  type Directory,
  type Entity,
  type Mutation,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import { rankBetween } from "@lictory/core/contracts/rank";
export type Entities = Record<string, Entity>;
export function reconcile(entities: Entities, changes: Change[]): Entities {
  const next = { ...entities };
  for (const change of changes) {
    if (change.operation === "delete") delete next[entityKey(change)];
    else next[entityKey(change.entity)] = change.entity;
  }
  return next;
}
// Optimistic overlays make safe local changes visible immediately. They are
// replayed over confirmed state and discarded once the server answers, so a
// predicted value (such as an item number) is corrected automatically.
export function optimistic(
  entities: Entities,
  mutations: Mutation[],
  userId: string,
  // The server names the review after its discipline; predict from the
  // directory.
  disciplineName: (disciplineId: string) => string = () => "Review",
  // Project workflows and types predict the status of new items.
  directory?: Pick<Directory, "statuses" | "types" | "projects">,
): Entities {
  const next = { ...entities };
  const now = new Date().toISOString();
  for (const mutation of mutations) {
    const c = mutation.command;
    const organizationId = mutation.organizationId;
    switch (c.type) {
      case "createProject":
        next[`project:${c.projectId}`] = {
          type: "project",
          id: c.projectId,
          organizationId,
          name: c.name,
          slug: c.key.toLowerCase(),
          key: c.key,
          description: c.description?.trim() ? c.description.trim() : null,
          deliveryMode: c.setup?.deliveryMode ?? "native",
          readinessPolicy: c.setup?.readinessPolicy ?? "warn",
          estimateScale: c.setup?.estimateScale ?? "fibonacci",
          iterationMode: c.setup?.iterationMode ?? "manual",
          iterationWeeks: c.setup?.iterationWeeks ?? 2,
          iterationStartDay: c.setup?.iterationStartDay ?? 1,
          upcomingIterations: 2,
          aiActionPolicy: "advisory",
          mergeReadyNotice: true,
          sample: c.sample === true,
          archivedAt: null,
        };
        break;
      case "createWorkItem": {
        const teamId = c.teamId ?? null;
        const type = directory?.types.find((t) => t.id === c.typeId);
        const statuses =
          directory?.statuses.filter(
            (x) => x.projectId === c.projectId && !x.archivedAt,
          ) ?? [];
        const statusId =
          c.statusId ??
          (
            statuses.find((x) => x.category === "backlog") ??
            statuses.find((x) => x.category === "unstarted") ??
            statuses[0]
          )?.id;
        // Without the project's workflow the server's answer is awaited.
        if (!statusId || !type) break;
        const lastRank = Object.values(next)
          .filter(
            (e): e is WorkItem =>
              e.type === "workItem" && e.projectId === c.projectId,
          )
          .map((e) => e.rank)
          .sort()
          .at(-1);
        const numbers = Object.values(next)
          .filter(
            (e): e is WorkItem =>
              e.type === "workItem" && e.projectId === c.projectId,
          )
          .map((e) => e.number);
        const revisionId = `pending:${c.workItemId}`;
        next[`workItem:${c.workItemId}`] = {
          type: "workItem",
          id: c.workItemId,
          organizationId,
          projectId: c.projectId,
          teamId,
          typeId: c.typeId,
          parentId: c.parentId,
          number: Math.max(0, ...numbers) + 1,
          title: c.title,
          statusId,
          refinementState: type.hasSpecification ? "draft" : null,
          mainProtected: false,
          priority: "none",
          assigneeId: c.assigneeId ?? null,
          milestoneId: null,
          iterationId: c.iterationId ?? null,
          estimate: null,
          rank: rankBetween(lastRank ?? null, null),
          sourceRevisionId: null,
          labelIds: [],
          position:
            Math.max(
              0,
              ...Object.values(next)
                .filter(
                  (e): e is WorkItem =>
                    e.type === "workItem" && e.parentId === c.parentId,
                )
                .map((e) => e.position),
            ) + 1000,
          createdById: userId,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revisionId,
          revisionNumber: 1,
          openThreads: 0,
          blockingThreads: 0,
          openSuggestions: 0,
          suggestionReviewerIds: [],
          reviews: [],
          readinessPassed: 0,
          readinessTotal: 0,
          childCount: 0,
          childReadyCount: 0,
          childDoneCount: 0,
          childEstimate: 0,
        };
        next[`revision:${revisionId}`] = {
          type: "revision",
          id: revisionId,
          organizationId,
          workItemId: c.workItemId,
          number: 1,
          title: c.title,
          content: c.description ?? "",
          changeSummary: "Created",
          authorId: userId,
          createdAt: now,
        };
        break;
      }
      case "updateWorkItem": {
        const old = next[`workItem:${c.workItemId}`];
        if (old?.type !== "workItem") break;
        next[entityKey(old)] = {
          ...old,
          statusId: c.statusId ?? old.statusId,
          teamId: c.teamId === undefined ? old.teamId : c.teamId,
          refinementState: c.refinementState ?? old.refinementState,
          priority: c.priority ?? old.priority,
          assigneeId:
            c.assigneeId === undefined ? old.assigneeId : c.assigneeId,
          parentId: c.parentId === undefined ? old.parentId : c.parentId,
          iterationId:
            c.iterationId === undefined ? old.iterationId : c.iterationId,
          estimate: c.estimate === undefined ? old.estimate : c.estimate,
          updatedAt: now,
        };
        break;
      }
      case "rankWorkItem": {
        const old = next[`workItem:${c.workItemId}`];
        if (old?.type !== "workItem") break;
        const rankOf = (id: string | null) => {
          const e = id ? next[`workItem:${id}`] : undefined;
          return e?.type === "workItem" ? e.rank : null;
        };
        const low = rankOf(c.afterId);
        const high = rankOf(c.beforeId);
        if (low !== null && high !== null && low >= high) break;
        if (low === null && high === null) break;
        next[entityKey(old)] = { ...old, rank: rankBetween(low, high) };
        break;
      }
      case "addRelation": {
        const from = next[`workItem:${c.workItemId}`];
        if (from?.type !== "workItem") break;
        next[`relation:${c.relationId}`] = {
          type: "relation",
          id: c.relationId,
          organizationId,
          projectId: from.projectId,
          fromId: c.workItemId,
          toId: c.toId,
          kind: c.kind,
          createdById: userId,
          createdAt: now,
        };
        break;
      }
      case "removeRelation":
        delete next[`relation:${c.relationId}`];
        break;
      case "archiveWorkItem": {
        const old = next[`workItem:${c.workItemId}`];
        if (old?.type !== "workItem") break;
        next[entityKey(old)] = {
          ...old,
          archivedAt: c.archived ? now : null,
          updatedAt: now,
        };
        break;
      }
      case "createThread":
        next[`thread:${c.threadId}`] = {
          type: "thread",
          id: c.threadId,
          organizationId,
          workItemId: c.workItemId,
          revisionId: c.baseRevisionId,
          suggestionId: c.suggestionId ?? null,
          pullRequestId: c.pullRequestId ?? null,
          commitId: c.commitId ?? null,
          authorId: userId,
          status: "open",
          blocking: c.blocking,
          createdAt: now,
          anchor: {
            version: 1,
            kind: "document",
            section: c.section,
            ...(c.quote ? { quote: c.quote } : {}),
            ...(c.quote && c.occurrence ? { occurrence: c.occurrence } : {}),
          },
        };
        next[`message:${c.messageId}`] = {
          type: "message",
          id: c.messageId,
          organizationId,
          threadId: c.threadId,
          authorId: userId,
          body: c.body,
          createdAt: now,
        };
        break;
      case "replyToThread":
        next[`message:${c.messageId}`] = {
          type: "message",
          id: c.messageId,
          organizationId,
          threadId: c.threadId,
          authorId: userId,
          body: c.body,
          createdAt: now,
        };
        break;
      case "setThreadState": {
        const old = next[`thread:${c.threadId}`];
        if (old?.type === "thread")
          next[entityKey(old)] = {
            ...old,
            status: c.resolved ? "resolved" : "open",
            blocking: c.blocking,
          };
        break;
      }
      case "requestReview":
        next[`review:${c.reviewId}`] = {
          type: "review",
          id: c.reviewId,
          organizationId,
          workItemId: c.workItemId,
          revisionId: c.baseRevisionId,
          responsibility: disciplineName(c.disciplineId),
          status: "requested",
          required: c.required,
          requestedById: userId,
          createdAt: now,
        };
        next[`assignment:pending:${c.reviewId}`] = {
          type: "assignment",
          id: `pending:${c.reviewId}`,
          organizationId,
          reviewId: c.reviewId,
          userId: c.userId,
          disciplineId: c.userId ? null : c.disciplineId,
          withdrawnAt: null,
        };
        break;
      case "cancelReview": {
        const old = next[`review:${c.reviewId}`];
        if (old?.type === "review")
          next[entityKey(old)] = { ...old, status: "cancelled" };
        break;
      }
      default:
        // Revision changes, suggestions and review decisions wait for server
        // validation: they depend on authorization or exact base revisions.
        break;
    }
  }
  return next;
}
export const retryDelay = (attempt: number) =>
  Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
