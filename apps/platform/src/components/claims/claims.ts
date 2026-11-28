import { useMemo } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type { AgentEntity } from "@lictory/core/factory/entities";
import {
  claimability,
  type Claimability,
  type ClaimabilityFacts,
  type LinkedPullRequestFact,
} from "@lictory/core/claims/claimability";
import {
  effectiveAutonomy,
  effectiveDoneChecks,
  type AutonomyPolicyEntity,
  type ClaimEntity,
  type DefinitionOfDoneEntity,
} from "@lictory/core/claims/contracts";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { byType, isTopLevel } from "@lictory/core/lib/work-items";
import {
  useDelivery,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodeList,
} from "@lictory/platform/components/code/store";

// The browser's view of claims, autonomy and the Definition of Done, read
// from the organization store (docs/internals/claims.md). Claimability is
// computed with the server's own function from the same synchronized facts,
// so the queue and the rail explain exactly what the server enforces.

// Live claims by work item, built once per store change however many rows
// ask for them.
const claimIndex = new WeakMap<object, Map<string, ClaimEntity>>();
export function useLiveClaims(): Map<string, ClaimEntity> {
  const { view } = useWorkspace();
  let index = claimIndex.get(view.entities);
  if (!index) {
    index = new Map(
      byType(Object.values(view.entities), "claim").map((c) => [
        c.workItemId,
        c,
      ]),
    );
    claimIndex.set(view.entities, index);
  }
  return index;
}

// The organization's agents by id (their names and avatars), without the
// Factory's window of recent sessions: boards and items only draw who holds
// work.
export function useAgents(): ReadonlyMap<string, AgentEntity> {
  const { organization } = useWorkspace();
  const [rows] = useQuery(queries.factory({ organizationId: organization.id }));
  return useMemo(
    () =>
      new Map(
        (rows as readonly { type: string; data: unknown }[])
          .filter((row) => row.type === "agent")
          .map((row) => {
            const agent = row.data as AgentEntity;
            return [agent.id, agent];
          }),
      ),
    [rows],
  );
}

export function useAutonomy(projectId: string) {
  const { view } = useWorkspace();
  return useMemo(() => {
    const stored: AutonomyPolicyEntity | undefined = byType(
      Object.values(view.entities),
      "autonomyPolicy",
    ).find((p) => p.projectId === projectId);
    return { stored, policy: effectiveAutonomy(stored) };
  }, [view.entities, projectId]);
}

export function useDefinitionOfDone(projectId: string) {
  const { view } = useWorkspace();
  return useMemo(() => {
    const stored: DefinitionOfDoneEntity | undefined = byType(
      Object.values(view.entities),
      "definitionOfDone",
    ).find((d) => d.projectId === projectId);
    return { stored, checks: effectiveDoneChecks(stored) };
  }, [view.entities, projectId]);
}

// "Forge via Ada": the agent and the accountable person it acts for. When
// the item is assigned to someone else (an agent claimed it explicitly),
// whose work it is too: "Forge via Ada, for Ben".
export function useAgentLabel() {
  const { memberName } = useWorkspace();
  return (
    claim: Pick<ClaimEntity, "agentName" | "ownerId">,
    assigneeId?: string | null,
  ) =>
    `${claim.agentName} via ${memberName(claim.ownerId)}${
      assigneeId && assigneeId !== claim.ownerId
        ? `, for ${memberName(assigneeId)}`
        : ""
    }`;
}

// Open and merged pull requests linked to work items, from the Code
// module's synchronized mirror, as claimability reads them: who opened each
// one, and whether an agent session of this factory did.
function useLinkedPullRequests() {
  const { memberName } = useWorkspace();
  const { identities } = useCodeHosts();
  const open = useCodeList("codePullRequest", "open").rows;
  const merged = useCodeList("codePullRequest", "merged").rows;
  return useMemo(() => {
    // The member behind a host login, as `useLoginOwner` reads it.
    const owner = new Map(
      identities.map((i) => [i.login.toLowerCase(), i.userId]),
    );
    const linked = new Map<string, LinkedPullRequestFact[]>();
    for (const pr of [...open, ...merged]) {
      const authorId =
        pr.openedById ??
        (pr.authorLogin ? owner.get(pr.authorLogin.toLowerCase()) : undefined);
      const fact: LinkedPullRequestFact = {
        number: pr.number,
        state: pr.state,
        openedByAgent: Boolean(pr.agentSessionId ?? pr.agentId),
        author: authorId ? memberName(authorId) : pr.authorLogin,
      };
      for (const link of pr.links)
        linked.set(link.workItemId, [
          ...(linked.get(link.workItemId) ?? []),
          fact,
        ]);
    }
    return linked;
  }, [open, merged, identities, memberName]);
}

// Claimability of any item of the organization, from synchronized facts.
export function useClaimability(): (item: WorkItem) => Claimability {
  const { items, relations, projects, directory } = useWorkspace();
  const delivery = useDelivery();
  const claims = useLiveClaims();
  const pullRequests = useLinkedPullRequests();
  return useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const blockers = new Map<string, string[]>();
    for (const r of relations)
      if (r.kind === "blocks")
        blockers.set(r.toId, [...(blockers.get(r.toId) ?? []), r.fromId]);
    const allProjects = projects.length ? projects : directory.projects;
    const keyOf = new Map(
      [...allProjects, ...directory.projects].map((p) => [p.id, p.key]),
    );
    const started = new Set(
      [...delivery.statuses.values()]
        .filter((x) => x.category === "started" && !x.archivedAt)
        .map((x) => x.projectId),
    );
    return (item: WorkItem) => {
      const project =
        allProjects.find((p) => p.id === item.projectId) ??
        directory.projects.find((p) => p.id === item.projectId);
      if (!project)
        return {
          claimable: false,
          stage: "outside",
          reasons: [],
        } satisfies Claimability;
      const facts: ClaimabilityFacts = {
        project,
        item: (id) => byId.get(id),
        key: (i) => `${keyOf.get(i.projectId) ?? "?"}-${i.number}`,
        category: (id) => delivery.statuses.get(id)?.category,
        statusName: (id) => delivery.statuses.get(id)?.name,
        hasSpecification: (id) =>
          delivery.types.get(id)?.hasSpecification ?? false,
        container: (id) => {
          const type = delivery.types.get(id);
          return type ? isTopLevel(type) : false;
        },
        blockers: (id) => blockers.get(id) ?? [],
        liveClaim: (id) => claims.get(id),
        hasStartedStatus: started.has(item.projectId),
        linkedPullRequests: (id) => pullRequests.get(id) ?? [],
        now: new Date(),
      };
      return claimability(item, facts);
    };
  }, [
    items,
    relations,
    projects,
    directory.projects,
    delivery,
    claims,
    pullRequests,
  ]);
}

// Minutes until a lease ends, for "expires in 12 min".
export function leaseLeft(claim: ClaimEntity, now = Date.now()) {
  return Math.round((new Date(claim.leaseExpiresAt).getTime() - now) / 60_000);
}

export {
  leaseLeftLabel,
  claimShownState,
  claimWaitsOnPeople,
  type ClaimShownState,
} from "@lictory/platform/components/claims/claim-state";
