import {
  entityKey,
  type Change,
  type Entity,
  type Mutation,
  type WorkItem,
} from "../shared/protocol";
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
): Entities {
  const next = { ...entities };
  const now = new Date().toISOString();
  for (const mutation of mutations) {
    const c = mutation.command;
    const organizationId = mutation.organizationId;
    switch (c.type) {
      case "createProduct":
        next[`product:${c.productId}`] = {
          type: "product",
          id: c.productId,
          organizationId,
          name: c.name,
          slug: c.key.toLowerCase(),
          key: c.key,
          description: null,
          archivedAt: null,
        };
        break;
      case "createWorkItem": {
        const numbers = Object.values(next)
          .filter(
            (e): e is WorkItem =>
              e.type === "workItem" && e.productId === c.productId,
          )
          .map((e) => e.number);
        const revisionId = `pending:${c.workItemId}`;
        next[`workItem:${c.workItemId}`] = {
          type: "workItem",
          id: c.workItemId,
          organizationId,
          productId: c.productId,
          parentId: c.parentId,
          kind: c.kind,
          number: Math.max(0, ...numbers) + 1,
          title: c.title,
          status: "draft",
          priority: "none",
          assigneeId: null,
          createdById: userId,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revisionId,
          revisionNumber: 1,
          openThreads: 0,
          blockingThreads: 0,
          pendingSuggestions: 0,
          reviews: [],
          readinessPassed: 0,
          readinessTotal: 0,
          childCount: 0,
          childReadyCount: 0,
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
          status: c.status ?? old.status,
          priority: c.priority ?? old.priority,
          assigneeId:
            c.assigneeId === undefined ? old.assigneeId : c.assigneeId,
          parentId: c.parentId === undefined ? old.parentId : c.parentId,
          updatedAt: now,
        };
        break;
      }
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
          authorId: userId,
          status: "open",
          blocking: c.blocking,
          createdAt: now,
          anchor: {
            version: 1,
            kind: "document",
            section: c.section,
            ...(c.quote ? { quote: c.quote } : {}),
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
          responsibility: c.responsibility,
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
          userId: c.target.type === "user" ? c.target.id : null,
          groupId: c.target.type === "group" ? c.target.id : null,
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
