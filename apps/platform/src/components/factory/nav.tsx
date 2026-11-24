import { useMemo } from "react";
import { Bot, Factory, MessageCircleQuestion, Server } from "lucide-react";
import { relativeTime } from "@lictory/core/lib/work-items";
import {
  sessionTitle,
  type SessionStatus,
} from "@lictory/core/factory/entities";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SidebarGroup,
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import {
  HomePanel,
  HomeRow,
} from "@lictory/platform/components/shell/home/panel";
import type {
  HomeCard,
  NavSection,
  NavSectionProps,
  PaletteEntry,
  PaletteProvider,
} from "@lictory/platform/components/shell/nav-registry";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  activeStatuses,
  statusLabels,
} from "@lictory/platform/components/factory/labels";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";

// The Factory in the shell (components/shell/nav-registry.tsx): its sidebar
// section, badge, palette entries and Home cards. The shell owns their
// placement; these own what they show. Everything reads the Factory's
// synchronized queries (one subscription, shared by Zero).

function FactorySection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const org = organization.slug;
  const overview = factoryPaths.overview(org);
  const agents = factoryPaths.agents(org);
  const runners = factoryPaths.runners(org);
  return (
    <SidebarGroup id="factory" label="Factory" badge={badge}>
      <SidebarLink
        href={overview}
        // A session's page belongs to the overview.
        active={active(overview, true) || active(`${overview}/sessions`)}
        icon={<Factory />}
        badge={badge}
      >
        Overview
      </SidebarLink>
      <SidebarLink href={agents} active={active(agents)} icon={<Bot />}>
        Agents
      </SidebarLink>
      <SidebarLink href={runners} active={active(runners)} icon={<Server />}>
        Runners
      </SidebarLink>
    </SidebarGroup>
  );
}

export const factorySection: NavSection = {
  id: "factory",
  label: "Factory",
  icon: Factory,
  href: factoryPaths.overview,
  // Sessions whose agent asks me (its owner, or who started it) something.
  useBadge: () => {
    const { userId } = useWorkspace();
    const { sessions, agentById } = useFactory();
    const waiting = waitingOnMe(sessions, agentById, userId).length;
    return waiting > 0
      ? {
          count: waiting,
          label:
            waiting === 1
              ? "agent session waiting on you"
              : "agent sessions waiting on you",
          tone: "strong",
        }
      : null;
  },
  Section: FactorySection,
};

// Jump to a session (active ones first) or to the agents.
export const factoryPalette: PaletteProvider = {
  id: "factory",
  group: "Factory",
  useEntries: () => {
    const { organization } = useWorkspace();
    const { sessions, agents, agentById } = useFactory();
    return useMemo(() => {
      const org = organization.slug;
      const active = new Set(activeStatuses);
      const ordered = [...sessions].sort(
        (a, b) =>
          Number(active.has(b.status)) - Number(active.has(a.status)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
      const entries: PaletteEntry[] = ordered.map((s) => ({
        id: `session-${s.id}`,
        label: sessionTitle(s.title),
        hint: `${agentById.get(s.agentId)?.name ?? "Agent"} · ${statusLabels[s.status]}`,
        icon: <Bot className="size-4" />,
        keywords: `agent session ${agentById.get(s.agentId)?.name ?? ""}`,
        href: factoryPaths.session(org, s.id),
      }));
      for (const agent of agents)
        if (!agent.archivedAt)
          entries.push({
            id: `agent-${agent.id}`,
            label: agent.name,
            hint: "Agent",
            icon: <Bot className="size-4" />,
            keywords: "agent factory",
            href: factoryPaths.agents(org),
          });
      return entries;
    }, [sessions, agents, agentById, organization.slug]);
  },
};

const SHOWN = 5;

// Questions and approvals agents wait on me for. Answering happens on the
// session's page, where its context is.
function AgentRequestsCard() {
  const { organization, userId } = useWorkspace();
  const { sessions, agentById } = useFactory();
  const requests = waitingOnMe(sessions, agentById, userId).flatMap((session) =>
    session.approvals.map((approval) => ({ session, approval })),
  );
  if (!requests.length) return null;
  const org = organization.slug;
  return (
    <HomePanel
      title="Agents ask you"
      icon={<MessageCircleQuestion />}
      count={requests.length}
      more={{ label: "Factory", href: factoryPaths.overview(org) }}
    >
      {requests.slice(0, SHOWN).map(({ session, approval }) => (
        <HomeRow
          key={approval.id}
          href={factoryPaths.session(org, session.id)}
          icon={<MessageCircleQuestion className="text-warning" />}
          title={approval.title}
          reason={`${agentById.get(session.agentId)?.name ?? "Agent"} · ${sessionTitle(session.title)}`}
          time={relativeTime(approval.createdAt)}
        />
      ))}
    </HomePanel>
  );
}

// Sessions at work right now (started, not queued), the ones waiting on me
// first.
const atWork: ReadonlySet<SessionStatus> = new Set([
  "assigned",
  "running",
  "waiting",
]);
function RunningSessionsCard() {
  const { organization, userId } = useWorkspace();
  const { sessions, agentById } = useFactory();
  const mine = new Set(
    waitingOnMe(sessions, agentById, userId).map((s) => s.id),
  );
  const working = sessions
    .filter((s) => atWork.has(s.status))
    .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
  if (!working.length) return null;
  const org = organization.slug;
  return (
    <HomePanel
      title="Agents at work"
      icon={<Factory />}
      count={working.length}
      more={{ label: "Factory", href: factoryPaths.overview(org) }}
    >
      {working.slice(0, SHOWN).map((session) => (
        <HomeRow
          key={session.id}
          href={factoryPaths.session(org, session.id)}
          icon={<Bot className="text-muted-foreground" />}
          title={sessionTitle(session.title)}
          reason={`${agentById.get(session.agentId)?.name ?? "Agent"} · ${statusLabels[session.status]}`}
          time={relativeTime(session.updatedAt)}
        />
      ))}
    </HomePanel>
  );
}

export const factoryHomeCards: readonly HomeCard[] = [
  { id: "agent-requests", label: "Agents ask you", Card: AgentRequestsCard },
  { id: "agents-at-work", label: "Agents at work", Card: RunningSessionsCard },
];
