import { useMemo } from "react";
import { Bot, Factory, Play, Plus, Server } from "lucide-react";
import { sessionTitle } from "@lictory/core/factory/entities";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
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
import { useFactory } from "@lictory/platform/components/factory/store";
import { agentsWaitingLabel } from "@lictory/platform/components/factory/overview-blocks";
import { useWaitingOnYou } from "@lictory/platform/components/workspace/inbox";
import { waitingGroup } from "@lictory/platform/components/shell/home/derive";

// The Factory in the shell (components/shell/nav-registry.tsx): its sidebar
// section, badge and palette entries (its Home cards are Home's own,
// components/shell/home/agent-cards.tsx). The shell owns their
// placement; these own what they show. Everything reads the Factory's
// synchronized queries (one subscription, shared by Zero).

// One row: the Factory page's own tabs lead to its agents and runners, so
// the sidebar does not repeat them.
function FactorySection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const overview = factoryPaths.overview(organization.slug);
  return (
    <SidebarLink
      href={overview}
      active={active(overview)}
      icon={<Factory />}
      badge={badge}
    >
      Factory
    </SidebarLink>
  );
}

export const factorySection: NavSection = {
  id: "factory",
  label: "Factory",
  icon: Factory,
  href: factoryPaths.overview,
  // What agents ask me (a decision or my next message), as a dot: the
  // Inbox's count already holds it (one number for what waits on me,
  // everywhere), so the Factory only says which part of that number is
  // here, counted as the Inbox's "Agents waiting on you" and the overview's
  // "Agents need you" count it, one row per request.
  useBadge: () => {
    const waiting = useWaitingOnYou();
    const agents = waiting.filter(
      (row) => waitingGroup(row) === "agents",
    ).length;
    const dot = agentsWaitingLabel(agents, waiting.length);
    return dot ? { count: 0, label: "", dot, tone: "quiet" } : null;
  },
  Section: FactorySection,
};

// Jump to a session (active ones first) or to the agents, or start the
// factory's own actions: a session, a runner, an agent.
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
      entries.push(
        {
          id: "factory-start-session",
          label: "Start agent session",
          icon: <Play className="size-4" />,
          keywords: "new run agent session factory implement",
          href: `${factoryPaths.overview(org)}?start=new`,
        },
        {
          id: "factory-add-runner",
          label: "Add runner",
          icon: <Server className="size-4" />,
          keywords: "new runner machine connect install factory",
          href: `${factoryPaths.runners(org)}?add=1`,
        },
        {
          id: "factory-new-agent",
          label: "New agent",
          icon: <Plus className="size-4" />,
          keywords: "create agent factory",
          href: `${factoryPaths.agents(org)}?new=1`,
        },
      );
      return entries;
    }, [sessions, agents, agentById, organization.slug, stateOf]);
  },
};
