import { paths } from "@lictory/core/lib/paths";

// The first run of a factory, derived from data: each step is done when the
// organization has what it sets up, so the checklist needs no state of its
// own, never lies about progress, and leaves Home once everything exists.

export type SetupFacts = {
  codeConnections: readonly { status: string }[];
  runners: readonly { lastSeenAt: string | null; revokedAt: string | null }[];
  agents: readonly { archivedAt: string | null }[];
  channels: readonly { kind: string; archivedAt: number | string | null }[];
  // People in the organization, including me.
  members: number;
};

export type SetupStepId = "code" | "runner" | "agent" | "channel" | "team";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  detail: string;
  done: boolean;
  // What to do next, when the person may do it.
  action: { label: string; href: string } | null;
};

export function setupSteps(
  facts: SetupFacts,
  org: string,
  isAdmin: boolean,
): { steps: SetupStep[]; done: number; complete: boolean } {
  const steps: SetupStep[] = [
    {
      id: "code",
      title: "Connect a code host",
      detail:
        "GitHub, GitLab or Bitbucket: agents open pull requests there, and Done follows their checks.",
      done: facts.codeConnections.some((c) => c.status === "active"),
      action: isAdmin
        ? { label: "Connect", href: paths.settings(org, "code") }
        : null,
    },
    {
      id: "runner",
      title: "Connect a runner",
      detail:
        "A machine you control where agents work in isolated checkouts: a server, a VPS or a laptop.",
      // Connected at least once: a laptop that sleeps stays set up.
      done: facts.runners.some((r) => !r.revokedAt && r.lastSeenAt !== null),
      action: { label: "Add runner", href: paths.factory(org) + "/runners" },
    },
    {
      id: "agent",
      title: "Create an agent",
      detail:
        "A named agent with an owner and a scope, that people mention in channels and the policy dispatches.",
      done: facts.agents.some((a) => !a.archivedAt),
      action: { label: "Create agent", href: paths.factory(org) + "/agents" },
    },
    {
      id: "channel",
      title: "Start a channel",
      detail:
        "Where the team and its agents talk; what matters is promoted into proposals and decisions.",
      done: facts.channels.some((c) => c.kind !== "direct" && !c.archivedAt),
      action: { label: "New channel", href: paths.channels(org) },
    },
    {
      id: "team",
      title: "Invite your team",
      detail: "Product, engineering and QA decide together what agents build.",
      done: facts.members > 1,
      action: isAdmin
        ? { label: "Invite", href: paths.settings(org, "members") }
        : null,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, complete: done === steps.length };
}
