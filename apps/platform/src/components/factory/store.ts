import { useMemo } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type {
  AgentEntity,
  RunnerEntity,
  SessionEntity,
  SessionEventRow,
} from "@lictory/core/factory/entities";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// The Factory as the browser sees it: synchronized `factory_entity` rows
// (agents, runners, a window of recent sessions) and one session's event
// log, live through Zero. Nothing here polls.

type Row = { readonly type: string; readonly data: unknown };

// Recent sessions kept synchronized for the overview and lists.
const SESSION_WINDOW = 200;

export function useFactory() {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.factory({ organizationId: organization.id }),
  );
  const [sessionRows, sessionsResult] = useQuery(
    queries.factorySessions({
      organizationId: organization.id,
      limit: SESSION_WINDOW,
    }),
  );
  return useMemo(() => {
    const agents: AgentEntity[] = [];
    const runners: RunnerEntity[] = [];
    for (const row of rows as readonly Row[])
      if (row.type === "agent") agents.push(row.data as AgentEntity);
      else if (row.type === "runner") runners.push(row.data as RunnerEntity);
    agents.sort((a, b) => a.name.localeCompare(b.name));
    runners.sort((a, b) => a.name.localeCompare(b.name));
    const sessions = (sessionRows as readonly Row[]).map(
      (row) => row.data as SessionEntity,
    );
    return {
      agents,
      agentById: new Map(agents.map((a) => [a.id, a])),
      runners,
      runnerById: new Map(runners.map((r) => [r.id, r])),
      sessions,
      complete:
        result.type === "complete" && sessionsResult.type === "complete",
    };
  }, [rows, sessionRows, result.type, sessionsResult.type]);
}

export function useSession(sessionId: string) {
  const { organization } = useWorkspace();
  const [row, result] = useQuery(
    queries.factorySession({ organizationId: organization.id, sessionId }),
  );
  return {
    session: (row as Row | undefined)?.data as SessionEntity | undefined,
    complete: result.type === "complete",
  };
}

// The latest `limit` events of a session, oldest first.
export function useSessionEvents(sessionId: string, limit: number) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.factorySessionEvents({
      organizationId: organization.id,
      sessionId,
      limit,
    }),
  );
  const events = useMemo(
    () => [...(rows as readonly SessionEventRow[])].reverse(),
    [rows],
  );
  return { events, complete: result.type === "complete" };
}

// Approval requests I may answer: sessions I started or whose agent I own.
export function waitingOnMe(
  sessions: SessionEntity[],
  agentById: ReadonlyMap<string, AgentEntity>,
  userId: string,
) {
  return sessions.filter(
    (s) =>
      s.status === "waiting" &&
      s.approvals.length > 0 &&
      (s.requestedById === userId ||
        agentById.get(s.agentId)?.ownerId === userId),
  );
}
