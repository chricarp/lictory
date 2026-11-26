import type {
  EntityOf,
  ReadinessPolicy,
  StatusCategory,
} from "@lictory/core/contracts/protocol";

// Whether an agent may claim a work item, computed in one place: the claim
// transaction enforces it, `listClaimableItems` and the Factory queue show
// it, and the browser explains it from its synchronized store. Pure: every
// caller gathers the facts its own way (docs/internals/claims.md).

export type ClaimabilityItem = Pick<
  EntityOf<"workItem">,
  | "id"
  | "projectId"
  | "typeId"
  | "parentId"
  | "number"
  | "statusId"
  | "refinementState"
  | "committedRevisionId"
  | "committedRevisionNumber"
  | "revisionId"
  | "revisionNumber"
  | "readinessPassed"
  | "readinessTotal"
  | "archivedAt"
>;

export type ClaimabilityFacts = {
  project: {
    id: string;
    key: string;
    deliveryMode: "native" | "external";
    readinessPolicy: ReadinessPolicy;
    archivedAt: string | null;
  };
  // Any item of the organization (parents, blockers), by id.
  item(id: string): ClaimabilityItem | undefined;
  // KEY-number of any item, for messages.
  key(item: ClaimabilityItem): string;
  category(statusId: string): StatusCategory | undefined;
  statusName(statusId: string): string | undefined;
  hasSpecification(typeId: string): boolean;
  // A container type (Epic by default, `isTopLevel`): it groups
  // implementation work; agents take its children, never the container.
  container(typeId: string): boolean;
  // Items with a `blocks` relation to this item.
  blockers(itemId: string): string[];
  // The item's live claim, if any (expired leases do not hold).
  liveClaim(
    itemId: string,
  ): { leaseExpiresAt: string; state: string; agentName: string } | undefined;
  // The project has an active status in the started category.
  hasStartedStatus: boolean;
  // Open and merged pull requests linked to the item, from the Code
  // module's mirror. Optional: a caller without code evidence leaves it
  // out, and callers may supply it only for items otherwise claimable.
  linkedPullRequests?(itemId: string): LinkedPullRequestFact[];
  now: Date;
};

export type LinkedPullRequestFact = {
  number: number | null;
  state: "open" | "merged" | "closed";
  // Opened from an agent session of this factory: agent work the factory
  // may take again once that session's claim ended (a retry).
  openedByAgent: boolean;
  // Who opened it, in words: a member's name or the host login.
  author: string | null;
};

export const claimRefusalCodes = [
  "external_delivery",
  "project_archived",
  "archived",
  "status_not_claimable",
  "container",
  "claimed",
  "blocked_by",
  "scope_not_accepted",
  "not_ready",
  "parent_scope_not_accepted",
  "parent_not_ready",
  "parent_closed",
  "not_selected",
  "no_started_status",
  "pull_request_linked",
] as const;
export type ClaimRefusalCode = (typeof claimRefusalCodes)[number];

export type ClaimRefusal = {
  code: ClaimRefusalCode;
  // In people's words: the browser shows it as it is.
  message: string;
  // The capability that clears it, for agents (MCP), who act by name.
  command?: string;
  // Items the reason names (blockers, the parent specification).
  itemIds?: string[];
};

// Where the item stands for the Factory queue.
// - claimable: an agent can claim it now.
// - claimed: a live claim holds it.
// - needs_agreement: a person has to accept scope or select the work.
// - blocked: agreed, but something else must happen first.
// - outside: not delivery the factory takes (external, started, closed,
//   archived, an agreed container such as an Epic).
export type ClaimStage =
  "claimable" | "claimed" | "needs_agreement" | "blocked" | "outside";

export type Claimability = {
  claimable: boolean;
  stage: ClaimStage;
  reasons: ClaimRefusal[];
};

const outsideCodes: ClaimRefusalCode[] = [
  "external_delivery",
  "project_archived",
  "archived",
  "status_not_claimable",
];
const agreementCodes: ClaimRefusalCode[] = [
  "scope_not_accepted",
  "parent_scope_not_accepted",
  "not_selected",
];

const startable: StatusCategory[] = ["backlog", "unstarted"];

// An accepted agreement keeps covering its work while an amendment is
// refined (delivery.md, "Agreed and delivered scope"); otherwise readiness
// must hold unless the project's readiness policy is off. Agents never take
// the `warn` exception a person can take.
function readinessHolds(
  spec: ClaimabilityItem,
  policy: ReadinessPolicy,
): boolean {
  if (policy === "off") return true;
  if (spec.refinementState === "ready") return true;
  return Boolean(
    spec.committedRevisionId && spec.committedRevisionId !== spec.revisionId,
  );
}

export function claimability(
  item: ClaimabilityItem,
  facts: ClaimabilityFacts,
): Claimability {
  const reasons: ClaimRefusal[] = [];
  const own = facts.key(item);
  const { project } = facts;
  const refuse = (
    code: ClaimRefusalCode,
    message: string,
    itemIds?: string[],
    command?: string,
  ) =>
    reasons.push({
      code,
      message,
      ...(itemIds ? { itemIds } : {}),
      ...(command ? { command } : {}),
    });

  if (project.deliveryMode !== "native")
    refuse(
      "external_delivery",
      `${project.key} hands delivery to an external tool, which owns execution. Agents claim work only in projects that deliver in Lictory.`,
    );
  if (project.archivedAt)
    refuse("project_archived", `${project.key} is archived.`);
  if (item.archivedAt) refuse("archived", `${own} is archived.`);
  const category = facts.category(item.statusId);
  if (!category || !startable.includes(category))
    refuse(
      "status_not_claimable",
      `${own} is ${facts.statusName(item.statusId) ?? "in an unknown status"}${category ? ` (${category})` : ""}. Only work that has not started can be claimed.`,
    );
  if (facts.container(item.typeId))
    refuse(
      "container",
      `${own} groups implementation work. Agents claim the work under it, never the container itself.`,
    );
  const claim = facts.liveClaim(item.id);
  // A waiting claim holds the item without a lease; others until it ends.
  if (
    claim &&
    (claim.state === "waiting" || new Date(claim.leaseExpiresAt) > facts.now)
  )
    refuse(
      "claimed",
      claim.state === "waiting"
        ? `${own} is claimed by ${claim.agentName}, which is waiting on a question to people.`
        : `${own} is claimed by ${claim.agentName} until ${claim.leaseExpiresAt}.`,
    );

  const blocking = facts
    .blockers(item.id)
    .map((id) => facts.item(id))
    .filter((b): b is ClaimabilityItem => Boolean(b && !b.archivedAt))
    .filter((b) => facts.category(b.statusId) !== "done");
  if (blocking.length)
    refuse(
      "blocked_by",
      `Blocked by ${blocking
        .map((b) => {
          const state = facts.category(b.statusId);
          return state === "canceled"
            ? `${facts.key(b)} (canceled: remove the relation if it no longer applies)`
            : `${facts.key(b)} (${facts.statusName(b.statusId) ?? state ?? "unknown"})`;
        })
        .join(", ")}. Every item that blocks it must be done first.`,
      blocking.map((b) => b.id),
    );

  if (facts.hasSpecification(item.typeId)) {
    if (!item.committedRevisionId)
      refuse(
        "scope_not_accepted",
        `Agents start ${own} once a person accepts revision ${item.revisionNumber} for delivery.`,
        undefined,
        "acceptDeliveryScope",
      );
    else if (!readinessHolds(item, project.readinessPolicy))
      refuse(
        "not_ready",
        `${own} is not ready (${item.readinessPassed}/${item.readinessTotal} readiness checks pass) and ${project.key}'s readiness policy (${project.readinessPolicy}) gates starting work.`,
      );
  } else {
    // Plain work is covered by its nearest specification ancestor's
    // accepted scope. Independent plain work needs a person to select it.
    let ancestor: ClaimabilityItem | undefined;
    const seen = new Set<string>();
    let parentId = item.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = facts.item(parentId);
      if (!parent) break;
      if (facts.hasSpecification(parent.typeId)) {
        ancestor = parent;
        break;
      }
      parentId = parent.parentId;
    }
    if (!ancestor) {
      if (category === "backlog")
        refuse(
          "not_selected",
          `${own} has no specification and sits in the backlog. Move it to an unstarted status (such as Todo) to make it available to agents.`,
        );
    } else {
      const parentKey = facts.key(ancestor);
      const parentCategory = facts.category(ancestor.statusId);
      if (
        ancestor.archivedAt ||
        parentCategory === "done" ||
        parentCategory === "canceled"
      )
        refuse(
          "parent_closed",
          `Its specification ${parentKey} is ${ancestor.archivedAt ? "archived" : parentCategory}. Reopen it or move ${own} before agents work on it.`,
          [ancestor.id],
        );
      else if (!ancestor.committedRevisionId)
        refuse(
          "parent_scope_not_accepted",
          `Agents start ${own} once a person accepts its specification ${parentKey} for delivery.`,
          [ancestor.id],
        );
      else if (!readinessHolds(ancestor, project.readinessPolicy))
        refuse(
          "parent_not_ready",
          `Its specification ${parentKey} is not ready (${ancestor.readinessPassed}/${ancestor.readinessTotal} readiness checks pass) and ${project.key}'s readiness policy (${project.readinessPolicy}) gates starting work.`,
          [ancestor.id],
        );
    }
  }
  // Work someone is already doing: a pull request a person opened (not an
  // agent session of this factory) is linked, open or merged. The
  // dispatcher leaves it alone; a person can still start an agent on it.
  const human = (facts.linkedPullRequests?.(item.id) ?? []).find(
    (pr) => pr.state !== "closed" && !pr.openedByAgent,
  );
  if (human)
    refuse(
      "pull_request_linked",
      `A pull request is already linked: ${human.number === null ? "one" : `#${human.number}`}${human.author ? ` by ${human.author}` : ""}${human.state === "merged" ? " (merged)" : ""}. Someone is already doing this work; a person can still start an agent on it.`,
    );
  if (!facts.hasStartedStatus)
    refuse(
      "no_started_status",
      `${project.key}'s workflow has no active started status to move claimed work into. A project administrator adds one under Workflow.`,
    );

  const codes = new Set(reasons.map((r) => r.code));
  const stage: ClaimStage = !reasons.length
    ? "claimable"
    : codes.has("claimed")
      ? "claimed"
      : outsideCodes.some((c) => codes.has(c))
        ? "outside"
        : agreementCodes.some((c) => codes.has(c))
          ? "needs_agreement"
          : // An agreed container is not the factory's work; its children are.
            codes.has("container")
            ? "outside"
            : "blocked";
  return { claimable: reasons.length === 0, stage, reasons };
}
