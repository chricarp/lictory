import type {
  AgentEntity,
  SessionEntity,
  SessionStatus,
} from "@lictory/core/factory/entities";

// The Factory overview's blocks. Every session is in exactly one:
// - needsYou: it waits on a person and I am the one who answers (I started
//   it or own its agent);
// - waitingOnOthers: it waits on a teammate (the team's view of who holds
//   an agent up), longest waiting first;
// - running: everything else still moving (queued, starting, running);
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
  const waitingOnOthers: SessionEntity[] = [];
  const running: SessionEntity[] = [];
  const recent: SessionEntity[] = [];
  for (const session of sessions) {
    if (!moving.has(session.status)) recent.push(session);
    else if (waitsOnMe(session, agentById, userId)) needsYou.push(session);
    else if (session.status === "waiting") waitingOnOthers.push(session);
    else running.push(session);
  }
  waitingOnOthers.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
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
    waitingOnOthers,
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

// How long a session ran: from when a runner started it (or when it was
// asked for, if it never started) to when it ended, or until now while it
// moves. Queued time is not running time, so a session that never left the
// queue has none.
export function sessionDuration(
  session: Pick<
    SessionEntity,
    "status" | "createdAt" | "startedAt" | "completedAt"
  >,
  now = Date.now(),
): number | null {
  if (!session.startedAt) return null;
  const end = session.completedAt ? Date.parse(session.completedAt) : now;
  return Math.max(0, end - Date.parse(session.startedAt));
}

// The agents' part of what waits on me, said as a part of the one total
// Home, the Inbox and the sidebar's Inbox count show ("4 of the 7 waiting
// on you are from agents"), so no surface gives a second number for the
// same question. Null when no agent waits on me.
export function agentsWaitingLabel(agents: number, total: number) {
  if (agents <= 0) return null;
  if (agents >= total)
    return agents === 1
      ? "1 waiting on you, from an agent"
      : `${agents} waiting on you, all from agents`;
  return `${agents} of the ${total} waiting on you ${agents === 1 ? "is" : "are"} from agents`;
}

// "45s", "4m", "1h 12m", "2d 3h": precise enough to compare runs. A run
// shorter than a second says so instead of "0s", which reads as no time.
export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 1) return "under 1s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
