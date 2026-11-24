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

const finishedAt = (s: SessionEntity) => s.completedAt ?? s.updatedAt;

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
    else if (
      session.status === "waiting" &&
      (session.requestedById === userId ||
        agentById.get(session.agentId)?.ownerId === userId)
    )
      needsYou.push(session);
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
