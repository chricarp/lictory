import type * as s from "@lictory/core/db/schema";
import type { HarnessId, Isolation } from "@lictory/core/factory/protocol";
import { ONLINE_SECONDS } from "@lictory/core/factory/protocol";

// The Factory's synchronized projections (`factory_entity.data`), as the
// browser reads them. Built only from these functions, so credentials and
// lease tokens can never reach a projection.

type AgentRow = typeof s.agent.$inferSelect;
type RunnerRow = typeof s.runner.$inferSelect;
type SessionRow = typeof s.agentSession.$inferSelect;
type ApprovalRow = typeof s.agentApproval.$inferSelect;

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

// A session title as people read it. Titles stored before the mention fix
// could start with "@@forge"; one "@" is what was typed.
export function sessionTitle(title: string) {
  return title.replace(/(^|\s)@@+(?=[\w-])/g, "$1@");
}

export type AgentKind = "runner" | "external" | "intelligence";
export type AgentAccess = "read" | "write";

export function agentEntity(row: AgentRow) {
  return {
    type: "agent" as const,
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    avatar: row.avatar,
    ownerId: row.ownerId,
    kind: row.kind,
    harness: row.harness as HarnessId | null,
    model: row.model,
    instructions: row.instructions,
    access: row.access as AgentAccess,
    projectIds: row.projectIds ?? null,
    shared: row.shared,
    defaultRunnerId: row.defaultRunnerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
  };
}
export type AgentEntity = ReturnType<typeof agentEntity>;

export function runnerEntity(row: RunnerRow) {
  return {
    type: "runner" as const,
    id: row.id,
    name: row.name,
    personal: row.ownerId !== null,
    ownerId: row.ownerId,
    prefix: row.credentialPrefix,
    os: row.os,
    arch: row.arch,
    version: row.version,
    hostname: row.hostname,
    harnesses: row.harnesses,
    labels: row.labels,
    maxSessions: row.maxSessions,
    isolation: row.isolation as Isolation,
    lastSeenAt: iso(row.lastSeenAt),
    registeredAt: row.registeredAt.toISOString(),
    revokedAt: iso(row.revokedAt),
  };
}
export type RunnerEntity = ReturnType<typeof runnerEntity>;

// Online means a heartbeat within the last minute. The projection records
// heartbeats at most once a minute, so readers allow a little more.
export function runnerOnline(
  runner: Pick<RunnerEntity, "lastSeenAt" | "revokedAt">,
  now = Date.now(),
) {
  if (runner.revokedAt || !runner.lastSeenAt) return false;
  return now - Date.parse(runner.lastSeenAt) < (ONLINE_SECONDS + 75) * 1000;
}

// Whether a runner may take a session of this agent now, by the claim's own
// rule (`claimSession`): online, reporting the agent's harness, the runner
// the session asked for if any, and only its owner's agents on a personal
// runner. Capacity is left out: a full runner takes it when a slot frees.
export function runnerCanRun(
  runner: Pick<
    RunnerEntity,
    "id" | "lastSeenAt" | "revokedAt" | "harnesses" | "ownerId"
  >,
  agent: Pick<AgentEntity, "kind" | "harness" | "ownerId" | "archivedAt">,
  session: Pick<SessionEntity, "requestedRunnerId">,
  now = Date.now(),
) {
  return (
    agent.kind === "runner" &&
    !agent.archivedAt &&
    agent.harness !== null &&
    runnerOnline(runner, now) &&
    runner.harnesses.some((h) => h.id === agent.harness) &&
    (!session.requestedRunnerId || session.requestedRunnerId === runner.id) &&
    (!runner.ownerId || runner.ownerId === agent.ownerId)
  );
}

// A queued session no online runner can take: it waits silently unless
// someone starts or adds a runner, so every surface says so.
export function waitsForRunner(
  session: Pick<SessionEntity, "status" | "requestedRunnerId">,
  agent:
    | Pick<AgentEntity, "kind" | "harness" | "ownerId" | "archivedAt">
    | undefined,
  runners: readonly Pick<
    RunnerEntity,
    "id" | "lastSeenAt" | "revokedAt" | "harnesses" | "ownerId"
  >[],
  now = Date.now(),
) {
  return (
    session.status === "queued" &&
    !!agent &&
    !runners.some((runner) => runnerCanRun(runner, agent, session, now))
  );
}

export type SessionStatus = SessionRow["status"];

// Whether a request asks a permission a person can approve: it names the
// action (the tool, with its input, as a harness's permission prompt states
// it). A request naming none is a question: a person answers it in words or
// denies it, and nothing is approved on a title, since text is never
// permission (docs/internals/factory.md#approval-requests).
export function asksPermission(
  detail: Readonly<Record<string, unknown>> | null | undefined,
) {
  return typeof detail?.tool === "string" && detail.tool.trim() !== "";
}

export function approvalEntity(row: ApprovalRow) {
  return {
    id: row.id,
    requestKey: row.requestKey,
    title: row.title,
    detail: row.detail,
    status: row.status,
    decidedById: row.decidedById,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    decidedAt: iso(row.decidedAt),
  };
}
export type ApprovalEntity = ReturnType<typeof approvalEntity>;

const PROMPT_PREVIEW = 4000;

export function sessionEntity(row: SessionRow, approvals: ApprovalRow[]) {
  return {
    type: "session" as const,
    id: row.id,
    agentId: row.agentId,
    runnerId: row.runnerId,
    requestedRunnerId: row.requestedRunnerId,
    requestedById: row.requestedById,
    // An autonomy policy started it: shown as "Build policy (set by Ada)".
    startedByPolicy: row.startedByPolicy ?? null,
    status: row.status,
    title: row.title,
    prompt:
      row.prompt.length > PROMPT_PREVIEW
        ? `${row.prompt.slice(0, PROMPT_PREVIEW)}…`
        : row.prompt,
    workItemId: row.workItemId,
    projectId: row.projectId,
    repositoryUrl: row.repositoryUrl,
    repositoryId: row.repositoryId,
    baseBranch: row.baseBranch,
    branch: row.branch,
    channelId: row.channelId,
    threadRootMessageId: row.threadRootMessageId,
    resultSummary: row.resultSummary,
    pullRequestId: row.pullRequestId,
    pullRequestUrl: row.pullRequestUrl,
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    eventCount: row.eventSequence,
    // Pending questions only; answered ones are in the event log.
    approvals: approvals
      .filter((a) => a.status === "pending")
      .map(approvalEntity),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: iso(row.assignedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
  };
}
export type SessionEntity = ReturnType<typeof sessionEntity>;

export type FactoryEntity = AgentEntity | RunnerEntity | SessionEntity;

// One row of the event log as the browser reads it.
export type SessionEventRow = {
  readonly sessionId: string;
  readonly sequence: number;
  readonly type: string;
  readonly data: unknown;
  readonly createdAt: number;
};
