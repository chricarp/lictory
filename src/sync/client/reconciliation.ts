import {
  entityKey,
  type Change,
  type Entity,
  type Mutation,
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
export function optimistic(
  entities: Entities,
  mutations: Mutation[],
  userId: string,
): Entities {
  const next = { ...entities };
  for (const mutation of mutations) {
    const c = mutation.command;
    if (c.type === "createProposal")
      next[`proposal:${c.proposalId}`] = {
        type: "proposal",
        id: c.proposalId,
        organizationId: mutation.organizationId,
        productId: c.productId,
        title: c.title,
        problemStatement: c.problem,
        status: "draft",
        archivedAt: null,
      };
    if (c.type === "replyToThread")
      next[`message:${c.messageId}`] = {
        type: "message",
        id: c.messageId,
        organizationId: mutation.organizationId,
        threadId: c.threadId,
        authorId: userId,
        body: c.body,
        createdAt: "Pending",
      };
    if (c.type === "setThreadState") {
      const old = next[`thread:${c.threadId}`];
      if (old?.type === "thread")
        next[entityKey(old)] = {
          ...old,
          status: c.resolved ? "resolved" : "open",
          blocking: c.blocking,
        };
    }
  }
  return next;
}
export const retryDelay = (attempt: number) =>
  Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
