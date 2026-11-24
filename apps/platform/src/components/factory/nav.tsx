import { useMemo } from "react";
import { Bot, Factory, Server } from "lucide-react";
import { sessionTitle } from "@lictory/core/factory/entities";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SidebarGroup,
  SidebarLink,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavSection,
  NavSectionProps,
  PaletteEntry,
  PaletteProvider,
} from "@lictory/platform/components/shell/nav-registry";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { activeStatuses } from "@lictory/platform/components/factory/labels";
import { useSessionStateOf } from "@lictory/platform/components/factory/parts";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";

// The Factory in the shell (components/shell/nav-registry.tsx): its sidebar
// section, badge and palette entries (its Home cards are Home's own,
// components/shell/home/agent-cards.tsx). The shell owns their
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
  // Sessions waiting on me (I started them or own their agent) for a
  // decision or my next message: the overview's "Needs you", same count.
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
    const stateOf = useSessionStateOf();
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
        hint: agentById.get(s.agentId)?.name ?? "Agent",
        chip: <SessionStateChip state={stateOf(s, agentById.get(s.agentId))} />,
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
    }, [sessions, agents, agentById, organization.slug, stateOf]);
  },
};
