import { DomainError } from "@lictory/core/domain/errors";

// What a Factory agent may do (docs/internals/factory.md#authority).
//
// An agent is a delegation, not a principal of its own: every call it makes
// runs as its owner (the access token's user), so membership, application
// roles and discipline capabilities are the owner's, checked by the domain
// services as for the owner's own calls. The agent's scope then narrows
// that authority:
//
// - it acts only in its own organization;
// - a `read` agent only reaches queries;
// - with a project allowlist, it reaches only those projects. Anything that
//   cannot be shown to stay inside them (organization-wide searches, types,
//   spaces) is refused rather than filtered.
//
// So the effective authority is owner ∩ scope and never more than either.

export type AgentScope = {
  id: string;
  organizationId: string;
  name: string;
  handle: string;
  access: "read" | "write";
  // Null: every project of the organization.
  projectIds: readonly string[] | null;
  // Set for a session-scoped token issued to one agent session.
  sessionId: string | null;
};

const outside = (agent: AgentScope) =>
  new DomainError(
    "forbidden",
    `${agent.name} acts only in its own organization.`,
    undefined,
    "agent_scope",
  );

export function assertAgentOrganization(
  agent: AgentScope | null | undefined,
  organizationId: string | null,
) {
  if (!agent) return;
  if (organizationId !== agent.organizationId) throw outside(agent);
}

// The agent's project allowlist admits this project (null: the operation is
// organization-wide).
export function assertAgentProject(
  agent: AgentScope | null | undefined,
  projectId: string | null | undefined,
) {
  if (!agent?.projectIds) return;
  if (projectId && agent.projectIds.includes(projectId)) return;
  throw new DomainError(
    "forbidden",
    projectId
      ? `${agent.name} is limited to other projects. Its owner can widen its scope in Factory → Agents.`
      : `${agent.name} is limited to some projects and cannot use organization-wide operations. Name a project or work item in its scope.`,
    undefined,
    "agent_scope",
  );
}

// Agents never decide on behalf of a person in the Factory itself: answering
// an approval request, managing agents, runners and credentials.
export function assertPerson(
  agent: AgentScope | null | undefined,
  what: string,
) {
  if (!agent) return;
  throw new DomainError(
    "forbidden",
    `${agent.name} is an agent; ${what} is a person's decision.`,
    undefined,
    "agent_scope",
  );
}
