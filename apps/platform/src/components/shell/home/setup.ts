import { paths } from "@lictory/core/lib/paths";

// The first run of a factory, derived from data: each step is done when the
// organization has what it sets up, so the checklist needs no state of its
// own, never lies about progress, and leaves Home once everything exists.

export type SetupFacts = {
  // The project new work goes to (the first active one), if any.
  project: { key: string } | null;
  // Work items in the organization, archived or not.
  workItems: number;
  codeConnections: readonly { status: string }[];
  runners: readonly { lastSeenAt: string | null; revokedAt: string | null }[];
  agents: readonly { archivedAt: string | null }[];
  channels: readonly { kind: string; archivedAt: number | string | null }[];
  // People in the organization, including me.
  members: number;
  // Invitations sent and not yet accepted.
  invited: number;
};

export type SetupStepId =
  "proposal" | "team" | "code" | "runner" | "agent" | "channel";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  detail: string;
  done: boolean;
  // Said even once done, when done does not tell the whole story.
  note?: string;
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
      // The product's core loop comes first: the factory builds what a
      // reviewed specification says.
      id: "proposal",
      title: "Write a first proposal",
      detail: "Agents build the approved revision",
      done: facts.workItems > 0,
      action: facts.project
        ? {
            label: "New proposal",
            href: paths.proposals(org, facts.project.key),
          }
        : null,
    },
    {
      id: "team",
      title: "Invite your team",
      detail: "Product, engineering and QA",
      // Inviting is the step; joining is the invitee's.
      done: facts.members > 1 || facts.invited > 0,
      ...(facts.members === 1 &&
        facts.invited > 0 && {
          note: `${facts.invited} invited, not joined yet`,
        }),
      action: isAdmin
        ? { label: "Invite", href: paths.settings(org, "members") }
        : null,
    },
    {
      id: "code",
      title: "Connect a code host",
      detail: "GitHub, GitLab or Bitbucket",
      done: facts.codeConnections.some((c) => c.status === "active"),
      action: isAdmin
        ? { label: "Connect", href: paths.settings(org, "code") }
        : null,
    },
    {
      id: "runner",
      title: "Connect a runner",
      detail: "A server, VPS or laptop where agents work",
      // Connected at least once: a laptop that sleeps stays set up.
      done: facts.runners.some((r) => !r.revokedAt && r.lastSeenAt !== null),
      action: { label: "Add runner", href: paths.factory(org) + "/runners" },
    },
    {
      id: "agent",
      title: "Create an agent",
      detail: "People mention it in channels",
      done: facts.agents.some((a) => !a.archivedAt),
      action: { label: "Create agent", href: paths.factory(org) + "/agents" },
    },
    {
      id: "channel",
      title: "Start a channel",
      detail: "Where the team and its agents talk",
      done: facts.channels.some((c) => c.kind !== "direct" && !c.archivedAt),
      action: { label: "New channel", href: paths.channels(org) },
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, complete: done === steps.length };
}
