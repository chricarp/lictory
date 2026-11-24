import { useMemo } from "react";
import {
  claimability,
  type Claimability,
  type ClaimabilityFacts,
} from "@lictory/core/claims/claimability";
import {
  effectiveAutonomy,
  effectiveDoneChecks,
  type AutonomyPolicyEntity,
  type ClaimEntity,
  type DefinitionOfDoneEntity,
} from "@lictory/core/claims/contracts";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { byType } from "@lictory/core/lib/work-items";
import {
  useDelivery,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";

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

// "Forge via Ada": the agent and the accountable person it acts for.
export function useAgentLabel() {
  const { memberName } = useWorkspace();
  return (claim: Pick<ClaimEntity, "agentName" | "ownerId">) =>
    `${claim.agentName} via ${memberName(claim.ownerId)}`;
}

// Claimability of any item of the organization, from synchronized facts.
export function useClaimability(): (item: WorkItem) => Claimability {
  const { items, relations, projects, directory } = useWorkspace();
  const delivery = useDelivery();
  const claims = useLiveClaims();
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
        blockers: (id) => blockers.get(id) ?? [],
        liveClaim: (id) => claims.get(id),
        hasStartedStatus: started.has(item.projectId),
        now: new Date(),
      };
      return claimability(item, facts);
    };
  }, [items, relations, projects, directory.projects, delivery, claims]);
}

// Minutes until a lease ends, for "expires in 12 min".
export function leaseLeft(claim: ClaimEntity, now = Date.now()) {
  return Math.round((new Date(claim.leaseExpiresAt).getTime() - now) / 60_000);
}

export const claimStateLabel: Record<ClaimEntity["state"], string> = {
  starting: "Starting",
  active: "Working",
  waiting: "Waiting on people",
};
