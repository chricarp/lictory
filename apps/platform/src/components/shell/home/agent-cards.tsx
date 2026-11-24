import { useMemo } from "react";
import { Factory } from "lucide-react";
import type { SessionStatus } from "@lictory/core/factory/entities";
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
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import type { HomeCard } from "@lictory/platform/components/shell/nav-registry";

// The factory floor on Home: the sessions at work that do not already wait
// on me. What agents ask me is part of Home's "Waiting on you" (one queue
// with reviews and page changes, the same as the Inbox's To do), so a
// session appears in one place only.

const SHOWN = 5;

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
            title={session.title}
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
  { id: "agents-at-work", label: "Agents at work", Card: RunningSessionsCard },
];
