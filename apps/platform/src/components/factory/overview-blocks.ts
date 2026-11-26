import type {
  AgentEntity,
  SessionEntity,
  SessionStatus,
} from "@lictory/core/factory/entities";

// The Factory overview's three blocks. Every session is in exactly one:
// - needsYou: it waits on a person and I am the one who answers (I started
//   it or own its agent);
// - running: everything else still moving (queued, starting, running, or
//   waiting on someone else);
// - recent: finished (completed, failed, canceled), newest first.

const moving: ReadonlySet<SessionStatus> = new Set([
  "queued",
  "assigned",
  "running",
  "waiting",
]);

const finishedAt = (s: Pick<SessionEntity, "completedAt" | "updatedAt">) =>
  s.completedAt ?? s.updatedAt;

// A session waits on me when it waits on a person (a decision, or my next
// message) and I am the one who answers: I started it or own its agent.
// The one rule behind the Factory's badge, the overview's "Needs you" and
// the agents in Home's and the Inbox's "Waiting on you", so they always
// count the same sessions.
export function waitsOnMe(
  session: Pick<SessionEntity, "status" | "requestedById" | "agentId">,
  agentById: ReadonlyMap<string, Pick<AgentEntity, "ownerId">>,
  userId: string,
) {
  return (
    session.status === "waiting" &&
    (session.requestedById === userId ||
      agentById.get(session.agentId)?.ownerId === userId)
  );
}

// How long a failed session stays on the To do of the person who started
// it, unless it is retried or later work on its item replaces it.
export const FAILED_TODO_DAYS = 7;

// Failed sessions waiting on me to retry them or decide what next: I
// started them (a policy's sessions are requested by the agent's owner),
// they failed in the last week, and no later session works on their item.
// A failure is work for its requester, not news.
export function failedForMe<
  S extends Pick<
    SessionEntity,
    | "id"
    | "status"
    | "requestedById"
    | "workItemId"
    | "createdAt"
    | "completedAt"
    | "updatedAt"
  >,
>(sessions: readonly S[], userId: string, now = Date.now()): S[] {
  const since = now - FAILED_TODO_DAYS * 24 * 60 * 60 * 1000;
  return sessions.filter(
    (session) =>
      session.status === "failed" &&
      session.requestedById === userId &&
      Date.parse(finishedAt(session)) >= since &&
      !sessions.some(
        (later) =>
          later.id !== session.id &&
          session.workItemId !== null &&
          later.workItemId === session.workItemId &&
          later.createdAt > session.createdAt,
      ),
  );
}

export function overviewBlocks(
  sessions: readonly SessionEntity[],
  agentById: ReadonlyMap<string, Pick<AgentEntity, "ownerId">>,
  userId: string,
) {
  const needsYou: SessionEntity[] = [];
  const running: SessionEntity[] = [];
  const recent: SessionEntity[] = [];
  for (const session of sessions) {
    if (!moving.has(session.status)) recent.push(session);
    else if (waitsOnMe(session, agentById, userId)) needsYou.push(session);
    else running.push(session);
  }
  // Decisions first (oldest question first: it has waited longest), then
  // what is at work before what is queued.
  needsYou.sort(
    (a, b) =>
      Number(b.approvals.length > 0) - Number(a.approvals.length > 0) ||
      a.updatedAt.localeCompare(b.updatedAt),
  );
  running.sort(
    (a, b) =>
      Number(a.status === "queued") - Number(b.status === "queued") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  recent.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  return {
    needsYou,
    running,
    recent,
    queued: running.filter((s) => s.status === "queued").length,
  };
}

// What an agent is doing now, from its sessions (newest first): the
// session that needs a person, else the one at work, else the queued one;
// and when it last did anything.
export function agentActivity(
  agentId: string,
  sessions: readonly SessionEntity[],
) {
  const own = sessions.filter((s) => s.agentId === agentId);
  const pick = (statuses: readonly SessionStatus[]) =>
    own.find((s) => statuses.includes(s.status));
  const current =
    pick(["waiting"]) ?? pick(["running", "assigned"]) ?? pick(["queued"]);
  const lastActive = own.reduce<string | null>(
    (latest, s) => (!latest || s.updatedAt > latest ? s.updatedAt : latest),
    null,
  );
  return {
    current: current ?? null,
    active: own.filter((s) => moving.has(s.status)).length,
    lastActive,
  };
}
