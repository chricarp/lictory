import { useMemo } from "react";
import { Factory, MessageCircleQuestion } from "lucide-react";
import {
  sessionTitle,
  type SessionStatus,
} from "@lictory/core/factory/entities";
import { identifier } from "@lictory/core/lib/work-items";
import { sessionState } from "@lictory/platform/lib/session-state";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";
import { useLiveClaims } from "@lictory/platform/components/claims/claims";
import {
  AgentActor,
  AgentAvatar,
} from "@lictory/platform/components/identity/actor";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import type { HomeCard } from "@lictory/platform/components/shell/nav-registry";

// The factory floor on Home: what agents ask me (each request reviewed in
// place, with its context, before it can be approved), then the sessions at
// work that do not already wait on me. A session appears in one card only.

const SHOWN = 5;

function AgentRequestsCard() {
  const { organization, userId } = useWorkspace();
  const { sessions, agentById, runnerById } = useFactory();
  const requests = waitingOnMe(sessions, agentById, userId).flatMap((session) =>
    session.approvals.map((approval) => ({ session, approval })),
  );
  return (
    <Panel
      title="Agents ask you"
      icon={<MessageCircleQuestion />}
      count={requests.length}
      more={{
        label: "Factory",
        href: factoryPaths.overview(organization.slug),
      }}
    >
      {requests.slice(0, SHOWN).map(({ session, approval }) => (
        <ApprovalRequest
          key={approval.id}
          compact
          session={session}
          approval={approval}
          agent={agentById.get(session.agentId)}
          runner={
            session.runnerId ? runnerById.get(session.runnerId) : undefined
          }
        />
      ))}
    </Panel>
  );
}

// Sessions at work right now (started, not queued).
const atWork: ReadonlySet<SessionStatus> = new Set([
  "assigned",
  "running",
  "waiting",
]);

function RunningSessionsCard() {
  const { organization, userId, items, projects, memberName } = useWorkspace();
  const { sessions, agentById } = useFactory();
  const claims = useLiveClaims();
  const working = useMemo(() => {
    const asked = new Set(
      waitingOnMe(sessions, agentById, userId).map((s) => s.id),
    );
    return sessions.filter((s) => atWork.has(s.status) && !asked.has(s.id));
  }, [sessions, agentById, userId]);
  const org = organization.slug;
  return (
    <Panel
      title="Agents at work"
      icon={<Factory />}
      count={working.length}
      more={{ label: "Factory", href: factoryPaths.overview(org) }}
    >
      {working.slice(0, SHOWN).map((session) => {
        const agent = agentById.get(session.agentId);
        const item = session.workItemId
          ? items.find((i) => i.id === session.workItemId)
          : undefined;
        const project = item
          ? projects.find((p) => p.id === item.projectId)
          : undefined;
        const state = sessionState(session, {
          claim: item ? claims.get(item.id) : null,
          decider: memberName(agent?.ownerId ?? session.requestedById),
        });
        return (
          <ListRow
            key={session.id}
            href={factoryPaths.session(org, session.id)}
            leading={
              agent ? <AgentAvatar agent={agent} size={20} /> : undefined
            }
            identifier={
              item && project ? identifier(project, item.number) : undefined
            }
            title={sessionTitle(session.title)}
            meta={
              <AgentActor
                agent={agent}
                ownerId={agent?.ownerId}
                avatar={false}
              />
            }
            chips={<SessionStateChip state={state} />}
            time={session.updatedAt}
          />
        );
      })}
    </Panel>
  );
}

export const agentHomeCards: readonly HomeCard[] = [
  { id: "agent-requests", label: "Agents ask you", Card: AgentRequestsCard },
  { id: "agents-at-work", label: "Agents at work", Card: RunningSessionsCard },
];
