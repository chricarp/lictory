import type { Command, Entity, Directory } from "~/sync/shared/protocol";

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null | string[]
>;
export type AnalyticsEvent = { event: string; properties: AnalyticsProperties };

// Exhaustive: adding a domain command requires choosing its analytics event.
export const commandEvents = {
  createProject: "project_created",
  updateProject: "project_updated",
  archiveProject: "project_archive_changed",
  setProjectMember: "project_member_changed",
  createDiscipline: "discipline_created",
  updateDiscipline: "discipline_updated",
  setDisciplineMember: "discipline_membership_changed",
  createWorkItem: "work_item_created",
  updateWorkItem: "work_item_updated",
  rankWorkItem: "work_item_ranked",
  addRelation: "relation_added",
  removeRelation: "relation_removed",
  reorderWorkItem: "work_item_reordered",
  createLabel: "label_created",
  updateLabel: "label_updated",
  createMilestone: "milestone_created",
  updateMilestone: "milestone_updated",
  archiveWorkItem: "work_item_archive_changed",
  updateSpecification: "specification_revised",
  createThread: "thread_created",
  replyToThread: "thread_replied",
  setThreadState: "thread_state_changed",
  createBranch: "branch_created",
  setBranchCollaborator: "branch_collaborator_changed",
  commitBranch: "branch_committed",
  syncBranch: "branch_updated",
  deleteBranch: "branch_deleted",
  createPullRequest: "pull_request_created",
  setPullRequestDraft: "pull_request_draft_changed",
  deletePullRequest: "pull_request_deleted",
  requestPullRequestReview: "pull_request_review_requested",
  decidePullRequest: "pull_request_review_decided",
  mergePullRequest: "pull_request_merged",
  revertSpecification: "specification_restored",
  createSuggestion: "suggestion_created",
  updateSuggestion: "suggestion_updated",
  setSuggestionState: "suggestion_state_changed",
  setSuggestionReviewer: "suggestion_reviewer_changed",
  decideSuggestion: "suggestion_decided",
  mergeSuggestion: "suggestion_merged",
  requestReview: "review_requested",
  cancelReview: "review_cancelled",
  decideReview: "review_decided",
  createTeam: "team_created",
  updateTeam: "team_updated",
  setTeamMembership: "team_membership_changed",
  setProjectType: "project_type_changed",
  createStatus: "workflow_status_created",
  updateStatus: "workflow_status_updated",
  archiveStatus: "workflow_status_archived",
  createType: "work_item_type_created",
  updateType: "work_item_type_updated",
  createIteration: "iteration_created",
  updateIteration: "iteration_updated",
  startIteration: "iteration_started",
  completeIteration: "iteration_completed",
  setAiPolicy: "ai_policy_changed",
  requestAiReview: "ai_review_requested",
  rerunAiAction: "ai_action_requested",
  createAiCorrectivePr: "ai_corrective_pr_created",
  applyAiSuggestion: "ai_suggestion_applied",
} satisfies Record<Command["type"], string>;

// Explicit allowlist: never spread a command, form, document or error into events.
const safeFields = [
  "projectId",
  "workItemId",
  "teamId",
  "typeId",
  "parentId",
  "statusId",
  "iterationId",
  "milestoneId",
  "reviewId",
  "disciplineId",
  "threadId",
  "suggestionId",
  "relationId",
  "baseRevisionId",
  "decision",
  "required",
  "blocking",
  "resolved",
  "archived",
  "open",
  "assigned",
  "member",
  "enabled",
  "kind",
  "status",
  "priority",
  "refinementState",
  "estimate",
  "deliveryMode",
  "readinessPolicy",
  "estimateScale",
  "iterationMode",
  "aiActionPolicy",
  "role",
  "hasSpecification",
  "level",
  "category",
] as const;
const snakeCase = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export function commandEvent(command: Command): AnalyticsEvent {
  const values = command as unknown as Record<string, unknown>;
  const properties: AnalyticsProperties = {
    command_type: command.type,
    changed_fields: Object.keys(command)
      .filter((key) => key !== "type")
      .sort(),
  };
  for (const key of safeFields) {
    const value = values[key];
    if (
      value === null ||
      ["string", "boolean", "number"].includes(typeof value)
    )
      properties[snakeCase(key)] = value as string | number | boolean | null;
  }
  if (command.type === "createWorkItem") {
    properties.has_description = Boolean(command.description);
    properties.is_decomposition = command.parentId !== null;
  }
  if (command.type === "updateWorkItem") {
    if (command.assigneeId !== undefined)
      properties.is_assigned = command.assigneeId !== null;
    if (command.labelIds !== undefined)
      properties.label_count = command.labelIds.length;
    if (command.iterationId !== undefined)
      properties.has_iteration = command.iterationId !== null;
  }
  if (
    (command.type === "createDiscipline" ||
      command.type === "updateDiscipline") &&
    command.capabilities
  )
    properties.enabled_capabilities = Object.entries(command.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name);
  if (command.type === "requestReview")
    properties.reviewer_assignment =
      command.userId === null ? "discipline" : "specific";
  if (command.type === "createThread") {
    properties.anchored = Boolean(command.quote) || Boolean(command.section);
    properties.context = command.suggestionId ? "suggestion" : "specification";
  }
  return { event: commandEvents[command.type], properties };
}

export function sanitizeAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function committedEvents(
  command: Command,
  before: Entity[],
  after: Entity[],
  directory?: Directory,
): AnalyticsEvent[] {
  const primary = commandEvent(command);
  const itemId = "workItemId" in command ? command.workItemId : undefined;
  const item = after.find(
    (entity) => entity.type === "workItem" && entity.id === itemId,
  );
  if (item?.type === "workItem") {
    const project = directory?.projects.find((p) => p.id === item.projectId);
    const status = directory?.statuses.find((x) => x.id === item.statusId);
    const type = directory?.types.find((type) => type.id === item.typeId);
    const previous = before.find(
      (entity) => entity.type === "workItem" && entity.id === itemId,
    );
    Object.assign(primary.properties, {
      ...(project ? { delivery_mode: project.deliveryMode } : {}),
      ...(type
        ? {
            work_item_type: type.name,
            has_specification: type.hasSpecification,
          }
        : {}),
      ...(status ? { status_category: status.category } : {}),
      ...(previous?.type === "workItem"
        ? {
            previous_status_id: previous.statusId,
            previous_refinement_state: previous.refinementState,
          }
        : {}),
      revision_number: item.revisionNumber,
      blocking_thread_count: item.blockingThreads,
      readiness_passed: item.readinessPassed,
      readiness_total: item.readinessTotal,
      project_id: item.projectId,
      team_id: item.teamId,
      type_id: item.typeId,
      refinement_state: item.refinementState,
      status_id: item.statusId,
      revision_id: item.revisionId,
    });
  }
  const events = [primary];
  const oldItems = new Map(
    before
      .filter((entity) => entity.type === "workItem")
      .map((entity) => [entity.id, entity]),
  );
  for (const entity of after) {
    if (entity.type === "workItem") {
      const previous = oldItems.get(entity.id);
      if (
        previous &&
        previous.refinementState !== entity.refinementState &&
        (previous.refinementState === "ready" ||
          entity.refinementState === "ready")
      ) {
        events.push({
          event:
            entity.refinementState === "ready"
              ? "specification_ready"
              : "specification_readiness_lost",
          properties: {
            work_item_id: entity.id,
            project_id: entity.projectId,
            team_id: entity.teamId,
            revision_id: entity.revisionId,
          },
        });
      }
    }
  }
  const oldApprovals = new Map(
    before
      .filter((entity) => entity.type === "approval")
      .map((entity) => [entity.id, entity]),
  );
  const staleCount = after.filter(
    (entity) =>
      entity.type === "approval" &&
      entity.status === "stale" &&
      oldApprovals.get(entity.id)?.status === "granted",
  ).length;
  if (staleCount)
    events.push({
      event: "approvals_invalidated",
      properties: { ...primary.properties, approval_count: staleCount },
    });
  return events;
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
) {
  const containers = [properties, properties.$set, properties.$set_once];
  for (const value of containers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const container = value as Record<string, unknown>;
    for (const key of [
      "$current_url",
      "$referrer",
      "$initial_current_url",
      "$initial_referrer",
    ]) {
      if (typeof container[key] === "string")
        container[key] = sanitizeAnalyticsUrl(container[key]);
    }
    delete container.$title;
    delete container.ph_keyword;
    delete container.$initial_ph_keyword;
  }
}

const workspacePath = /^\/app(\/|$)/;

// PostHog protocol fields that look like entity identifiers but are required for
// ingestion. In cookieless mode `distinct_id` is PostHog's sentinel, replaced by
// the server-side hash; dropping it makes PostHog reject the event.
const posthogReservedProperties = new Set(["distinct_id"]);

/**
 * Further reduces events captured without Analytics consent. Cookieless events
 * keep the event name and controlled values (types, categories, counts) but drop
 * entity identifiers and workspace paths, which could link anonymous activity
 * back to an organization or person.
 */
export function minimizeAnonymousAnalyticsProperties(
  properties: Record<string, unknown>,
) {
  for (const key of Object.keys(properties)) {
    if (posthogReservedProperties.has(key)) continue;
    if (!key.startsWith("$") && key.endsWith("_id")) delete properties[key];
  }
  delete properties.$groups;
  delete properties.$set;
  delete properties.$set_once;
  for (const key of ["$current_url", "$referrer", "$pathname"]) {
    const value = properties[key];
    if (typeof value !== "string") continue;
    if (key === "$pathname") {
      if (workspacePath.test(value)) properties[key] = "/app";
      continue;
    }
    try {
      const url = new URL(value);
      if (workspacePath.test(url.pathname))
        properties[key] = `${url.origin}/app`;
    } catch {
      // Already reduced by sanitizeAnalyticsProperties.
    }
  }
}
