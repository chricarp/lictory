import { z } from "zod";

// Claims, the autonomy policy and the Definition of Done
// (docs/internals/claims.md). Shared by the server, the browser and agents;
// this module knows no database and no protocol, so the protocol can list
// its entities.

const id = z.string().min(1).max(160);
const base = { id, organizationId: id };

// ------------------------------------------------------------ autonomy

// How much the factory does by itself in one project. Assist is the
// default: people start every session.
export const autonomyLevels = ["assist", "build", "autopilot"] as const;
export type AutonomyLevel = (typeof autonomyLevels)[number];
export const autonomyLevelMeta: Record<
  AutonomyLevel,
  { label: string; summary: string }
> = {
  assist: {
    label: "Assist",
    summary:
      "Agents help when asked. People start every session; nothing is dispatched automatically.",
  },
  build: {
    label: "Build",
    summary:
      "Claimable items are dispatched to the implementer agents in rank order, up to the concurrency limit. Agents open code pull requests; people merge them.",
  },
  autopilot: {
    label: "Autopilot",
    summary:
      "As Build, and Lictory merges an agent's code pull request when every required check passes. The merge is attributed to this policy and the administrator who set it.",
  },
};

// What must pass before Autopilot requests a merge. CI is always required.
export const autopilotRequirements = [
  "checks_passed",
  "code_review_approved",
  "definition_of_done",
] as const;
export type AutopilotRequirement = (typeof autopilotRequirements)[number];
export const autopilotRequirementLabels: Record<AutopilotRequirement, string> =
  {
    checks_passed: "Required CI checks passed on the head commit",
    code_review_approved: "The reviewer agent approved the head commit",
    definition_of_done: "Every other Definition of Done check passes",
  };

export const maxConcurrentSessionsLimit = 20;

export const autonomyPolicyInputSchema = z
  .object({
    level: z.enum(autonomyLevels),
    implementerAgentIds: z
      .array(id)
      .max(10)
      .describe(
        "Agents the dispatcher starts sessions for (Build, Autopilot).",
      ),
    reviewerAgentId: id
      .nullable()
      .describe(
        "The agent whose approval of a pull request's head commit counts as code review.",
      ),
    maxConcurrentSessions: z
      .number()
      .int()
      .min(1)
      .max(maxConcurrentSessionsLimit)
      .describe("Most claims the dispatcher holds at once in this project."),
    autopilotRequires: z
      .array(z.enum(autopilotRequirements))
      .max(autopilotRequirements.length)
      .describe(
        "Autopilot only: what must pass before Lictory requests a merge. checks_passed is always required.",
      ),
  })
  .superRefine((policy, ctx) => {
    if (policy.level !== "assist" && policy.implementerAgentIds.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["implementerAgentIds"],
        message:
          "Choose at least one implementer agent: Build and Autopilot dispatch work to them.",
      });
    if (
      policy.level === "autopilot" &&
      !policy.autopilotRequires.includes("checks_passed")
    )
      ctx.addIssue({
        code: "custom",
        path: ["autopilotRequires"],
        message: "Autopilot always requires CI checks to pass before a merge.",
      });
  });
export type AutonomyPolicyInput = z.infer<typeof autonomyPolicyInputSchema>;

export const defaultAutonomyPolicy: AutonomyPolicyInput = {
  level: "assist",
  implementerAgentIds: [],
  reviewerAgentId: null,
  maxConcurrentSessions: 2,
  autopilotRequires: [...autopilotRequirements],
};

// ------------------------------------------------- Definition of Done

// Stable across edits, so sign-offs and overrides survive a change of the
// definition.
const checkId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Check ids use letters, digits, - and _.");

const codeKinds = [
  "pull_request_merged",
  "checks_passed",
  "code_review_approved",
] as const;
export const doneCheckKinds = [...codeKinds, "acceptance_verified"] as const;
export type DoneCheckKind = (typeof doneCheckKinds)[number];
export const isCodeCheck = (kind: DoneCheckKind) =>
  (codeKinds as readonly string[]).includes(kind);

export const doneCheckDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ id: checkId, kind: z.enum(codeKinds) }),
  // A person confirms the acceptance criteria were verified: a sign-off by
  // a member of the chosen disciplines (any discipline holder when empty).
  z.object({
    id: checkId,
    kind: z.literal("acceptance_verified"),
    label: z.string().trim().min(1, "Name the sign-off.").max(120),
    disciplineIds: z.array(id).max(20),
  }),
]);
export type DoneCheckDefinition = z.infer<typeof doneCheckDefinitionSchema>;

export const doneChecksSchema = z
  .array(doneCheckDefinitionSchema)
  .max(12, "A Definition of Done can require at most 12 checks.")
  .superRefine((checks, ctx) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    for (const check of checks) {
      if (ids.has(check.id))
        ctx.addIssue({ code: "custom", message: "Check ids must be unique." });
      ids.add(check.id);
      if (check.kind !== "acceptance_verified") {
        if (kinds.has(check.kind))
          ctx.addIssue({
            code: "custom",
            message: "Each code check can only be required once.",
          });
        kinds.add(check.kind);
      }
    }
  });

// What every project requires until its administrators change it: merged
// code with green CI. An empty definition means Done is only ever moved by
// people.
export const defaultDoneChecks: DoneCheckDefinition[] = [
  { id: "pull_request_merged", kind: "pull_request_merged" },
  { id: "checks_passed", kind: "checks_passed" },
];

const codeLabels: Record<(typeof codeKinds)[number], string> = {
  pull_request_merged:
    "A linked code pull request is merged and none is still open",
  checks_passed: "Required CI checks passed on the head commit",
  code_review_approved: "A reviewer approved the head commit",
};

// Labels say what a check verifies; only sign-offs are named by people.
export function doneCheckLabel(
  check: DoneCheckDefinition,
  reviewerAgentName?: string | null,
) {
  if (check.kind === "acceptance_verified") return check.label;
  if (check.kind === "code_review_approved" && reviewerAgentName)
    return `${reviewerAgentName} approved the head commit`;
  return codeLabels[check.kind];
}

// ------------------------------------------------------------ entities

export const liveClaimStates = ["starting", "active", "waiting"] as const;
export type LiveClaimState = (typeof liveClaimStates)[number];
export const claimSources = ["agent", "dispatcher"] as const;

// A live claim (organization level, so boards and lists show it). Released
// and completed claims leave the projection; their history is the item's
// activity.
export const claimEntitySchema = z.object({
  ...base,
  type: z.literal("claim"),
  projectId: id,
  workItemId: id,
  agentId: id,
  agentName: z.string(),
  agentSessionId: id.nullable(),
  // The accountable person the agent acts for.
  ownerId: id,
  source: z.enum(claimSources),
  state: z.enum(liveClaimStates),
  leaseExpiresAt: z.string(),
  claimedAt: z.string(),
  // Discussions the agent asked and people have not resolved yet.
  waitingThreadIds: z.array(id),
  lastProgress: z.string().nullable(),
  lastProgressAt: z.string().nullable(),
});

// A project's autonomy policy; absent means Lictory's defaults (Assist).
export const autonomyPolicyEntitySchema = z.object({
  ...base,
  type: z.literal("autonomyPolicy"),
  projectId: id,
  level: z.enum(autonomyLevels),
  implementerAgentIds: z.array(id),
  reviewerAgentId: id.nullable(),
  maxConcurrentSessions: z.number().int(),
  autopilotRequires: z.array(z.enum(autopilotRequirements)),
  version: z.number().int(),
  updatedById: id,
  updatedAt: z.string(),
});

// A project's Definition of Done; absent means Lictory's defaults.
export const definitionOfDoneEntitySchema = z.object({
  ...base,
  type: z.literal("definitionOfDone"),
  projectId: id,
  checks: doneChecksSchema,
  version: z.number().int(),
  updatedById: id,
  updatedAt: z.string(),
});

export const doneCheckResultSchema = z.object({
  key: z.string(),
  kind: z.enum(doneCheckKinds),
  label: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
  // Sign-off checks: who may sign off and the current sign-off.
  signOff: z
    .object({
      disciplineIds: z.array(id),
      signedOffBy: id.nullable(),
      signedOffAt: z.string().nullable(),
    })
    .optional(),
  // A person passed this check for this item and revision by hand.
  override: z
    .object({ by: id, at: z.string(), reason: z.string() })
    .nullable()
    .optional(),
});
export type DoneCheckResult = z.infer<typeof doneCheckResultSchema>;

export const codePullRequestSummarySchema = z.object({
  id,
  title: z.string(),
  url: z.string().nullable(),
  state: z.enum(["open", "merged", "closed"]),
  headSha: z.string().nullable(),
});

// Where one work item stands against its project's Definition of Done
// (item scope). Evidence, never an agent's report.
export const doneEvaluationEntitySchema = z.object({
  ...base,
  type: z.literal("doneEvaluation"),
  projectId: id,
  workItemId: id,
  checks: z.array(doneCheckResultSchema),
  passed: z.boolean(),
  // The revision sign-offs and overrides belong to: the accepted revision,
  // else the current one.
  revisionId: id.nullable(),
  code: z.object({
    connected: z.boolean(),
    explanation: z.string().nullable(),
    pullRequests: z.array(codePullRequestSummarySchema),
  }),
  // Why a passing item does not move to Done by itself, when it does not.
  held: z.string().nullable(),
});

export type ClaimEntity = z.infer<typeof claimEntitySchema>;
export type AutonomyPolicyEntity = z.infer<typeof autonomyPolicyEntitySchema>;
export type DefinitionOfDoneEntity = z.infer<
  typeof definitionOfDoneEntitySchema
>;
export type DoneEvaluationEntity = z.infer<typeof doneEvaluationEntitySchema>;

// Entity types listed at organization level (boards, lists, the queue).
export const claimOrganizationTypes = [
  "claim",
  "autonomyPolicy",
  "definitionOfDone",
] as const;

// The policy that governs a project: its stored row or the defaults.
export function effectiveAutonomy(
  stored:
    | Pick<
        AutonomyPolicyEntity,
        | "level"
        | "implementerAgentIds"
        | "reviewerAgentId"
        | "maxConcurrentSessions"
        | "autopilotRequires"
      >
    | null
    | undefined,
): AutonomyPolicyInput {
  return stored
    ? {
        level: stored.level,
        implementerAgentIds: stored.implementerAgentIds,
        reviewerAgentId: stored.reviewerAgentId,
        maxConcurrentSessions: stored.maxConcurrentSessions,
        autopilotRequires: stored.autopilotRequires,
      }
    : defaultAutonomyPolicy;
}

// The checks that govern a project: its stored definition or the defaults.
export function effectiveDoneChecks(
  stored: Pick<DefinitionOfDoneEntity, "checks"> | null | undefined,
) {
  return stored ? stored.checks : defaultDoneChecks;
}
