import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { committedEvents } from "@lictory/core/lib/analytics/events";
import {
  computeInsights,
  insightTopics,
} from "@lictory/core/intelligence/insights";
import {
  directory,
  executeMutation as executeDomainMutation,
  readWorkspace,
  type MutationOutcome,
  iterationReport,
  readinessHistory,
  readinessPreview,
  searchEpics,
  searchMembers,
} from "@lictory/core/domain/service";
import {
  PROTOCOL,
  applicationRoleOf,
  capabilitiesOf,
  commandSchema,
  epicSearchSchema,
  iterationReportQuerySchema,
  memberSearchSchema,
  mutationSchema,
  readinessHistoryQuerySchema,
  readinessPreviewQuerySchema,
  refinementStates,
  type Command,
  type Entity,
  type EntityOf,
  type Mutation,
} from "@lictory/core/contracts/protocol";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
  type Effects,
  type Surface,
} from "@lictory/core/capabilities/core";

// The single write path for workspace commands from capabilities (web, MCP,
// embedded agent): the domain service authorizes, applies, writes projections
// and records the idempotency receipt in one transaction; analytics follow the
// commit. Browsers write through Zero's mutate endpoint, which runs the same
// `applyMutation` in Zero's transaction.
export async function executeMutation(
  ctx: CapabilityContext,
  mutation: Mutation,
) {
  return executeDomainMutation(
    ctx.db,
    { userId: ctx.principal.userId },
    mutation,
    {
      onCommitted: (outcome) =>
        trackCommitted(ctx.effects, outcome, ctx.principal.surface),
    },
  );
}

// Product analytics for a committed mutation. Shared with the Zero mutate
// endpoint.
export function trackCommitted(
  effects: Effects,
  { mutation, before, after, directory: roster }: MutationOutcome,
  surface: Surface = "web",
) {
  for (const event of committedEvents(mutation.command, before, after, roster))
    effects.track(
      event.event,
      {
        ...event.properties,
        organization_id: mutation.organizationId,
        mutation_id: mutation.id,
        ...(surface === "web" ? {} : { surface }),
      },
      `${mutation.organizationId}:${mutation.id}:${String(event.properties.work_item_id ?? "")}`,
    );
}

type CommandType = Command["type"];
type CommandDoc = {
  title: string;
  description: string;
  destructive?: true;
  decision?: true;
};

// Every workspace command must be described here. Adding a command to the
// protocol therefore exposes it to every surface once it has a description,
// and the type checker refuses a command without one.
const commandDocs: Record<CommandType, CommandDoc> = {
  createProject: {
    title: "Create project",
    description:
      "Organization administrators: create a project (a product area). `key` prefixes item identifiers, e.g. PAY. The project starts with the default workflow, every active type and the Product, Engineering and QA disciplines; the creator becomes its administrator. Optional `setup` records onboarding decisions.",
  },
  updateProject: {
    title: "Update project",
    description:
      "Project administrators: rename or describe the project and change its delivery settings: delivery mode (native = delivered in Lictory, external = handed off to Jira), readiness policy, estimate scale, iteration mode and cadence, and the Lictory Intelligence review action policy. External projects never plan iterations or estimate in Lictory.",
  },
  publishReadinessChecks: {
    title: "Publish Definition of Ready",
    description:
      "Project administrators: publish the next version of the project's Definition of Ready. `rules` maps a work item type id to its complete list of checks; types left out use Lictory's defaults. Check kinds: specification, no_blocking_threads, reviews_requested, reviews_approved, children_ready (each at most once per type), section (`heading` must exist and not be empty), discipline_approval (`disciplineIds` approved the current revision) and manual (a named sign-off by someone in `disciplineIds`, or anyone holding a discipline when empty). `baseRevisionId` is the current version id from getWorkspace (null while the project uses the defaults). Use previewReadinessChecks first. Items that are ready or done keep the checks they met; every other item moves to the new checks and becomes ready when they pass.",
    decision: true,
  },

  archiveProject: {
    title: "Archive project",
    description:
      "Organization administrators: archive (archived: true) or restore a project. Archived projects are read-only; history is kept.",
    destructive: true,
  },
  setProjectMember: {
    title: "Set project member",
    description:
      "Project administrators: add a person to the project as `admin` or `member`, change their project role, or remove them (role null), which also removes their disciplines and team memberships in the project.",
  },
  createDiscipline: {
    title: "Create discipline",
    description:
      "Project administrators: add a work discipline (e.g. Security) with the work item capabilities it grants in this project and whether it can be asked to review.",
  },
  updateDiscipline: {
    title: "Update discipline",
    description:
      "Project administrators: rename, describe, change capabilities, archive or restore a discipline. Archived disciplines grant nothing; reviews keep their name.",
  },
  setDisciplineMember: {
    title: "Set discipline member",
    description:
      "Project administrators: add or remove a person from a discipline. Adding someone also makes them a project member.",
  },
  createWorkItem: {
    title: "Create work item",
    description:
      "Create a work item (Epic, Story, Task, Bug, Subtask or a custom type enabled in the project). Spec-backed types require edit-specifications; plain types require edit-specifications or change-properties in the project. `teamId` is optional. `typeId` and `teamId` come from getWorkspace; `description` is Markdown and becomes the first revision. Unknown fields are rejected. Specification text belongs in `description`, not `content`. Set an estimate afterwards with updateWorkItem. The result includes `key` and `revisionId`.",
  },
  updateWorkItem: {
    title: "Update work item properties",
    description:
      "Change non-material properties: status, refinement state (draft, refinement, in_review; `ready` is derived from readiness checks), type, team (or null), priority, assignee, parent, milestone, iteration, estimate, labels. An estimate must be one of the project's scale (Fibonacci, linear, or T-shirt points). Moving a ready item back is rejected while its readiness checks still pass. Never creates a revision or stales approvals. Requires change-properties in the item's project.",
  },
  rankWorkItem: {
    title: "Rank work item",
    description:
      "Move an item in backlog/board order between two neighbours (null = open end). `afterId` is the item before this one and `beforeId` the item after it; reversed neighbours are rejected.",
  },
  addRelation: {
    title: "Add relation",
    description:
      "Link two work items: blocks, relates or duplicates (from this item to `toId`). Creating the same relation again is a conflict and names the existing relation id.",
  },
  removeRelation: {
    title: "Remove relation",
    description: "Remove a relation between work items.",
    destructive: true,
  },
  reorderWorkItem: {
    title: "Reorder child",
    description:
      "Order an item among its siblings: place before `beforeId` (null = last).",
  },
  createLabel: {
    title: "Create label",
    description: "Create a project label.",
  },
  updateLabel: {
    title: "Update label",
    description: "Rename, recolor, archive or restore a project label.",
  },
  createMilestone: {
    title: "Create milestone",
    description: "Create a project milestone with an optional target date.",
  },
  updateMilestone: {
    title: "Update milestone",
    description:
      "Rename, reschedule, change status, archive or restore a milestone.",
  },
  archiveWorkItem: {
    title: "Archive work item",
    description:
      "Archive (archived: true) or restore (archived: false) a work item. Archiving also archives active descendants. Restoring does not restore them. History is kept.",
  },
  updateSpecification: {
    title: "Revise specification",
    description:
      "Save a new revision of an item's title and Markdown specification. `baseRevisionId` must be the current revision (getWorkItem); a stale base is rejected with the current revision id. Material changes can stale approvals. Requires edit-specifications. Prefer createSuggestion when others should review the change.",
  },
  createThread: {
    title: "Start discussion",
    description:
      "Start a discussion thread anchored to a section (and optionally a quoted range) of a revision, a suggestion, a pull request or a commit. `section` must be a heading in that text, or empty to anchor the whole text. A pull request thread requires `commitId`. `blocking` threads block readiness until resolved.",
  },
  replyToThread: {
    title: "Reply to discussion",
    description: "Reply to an existing thread. Mentions notify people.",
  },
  setThreadState: {
    title: "Resolve or reopen discussion",
    description:
      "Resolve or reopen a thread and mark it blocking or non-blocking. History is kept.",
    decision: true,
  },
  createBranch: {
    title: "Create branch",
    description:
      "Start a named line of work on a specification, from the main line or another branch. Names are at most 80 characters and use letters, numbers, “-”, “_”, “.” and “/”, without “..”, “//”, a trailing separator, a “.lock” part, or the name main.",
  },
  setBranchCollaborator: {
    title: "Set branch collaborator",
    description: "Add or remove a collaborator on a branch.",
  },
  commitBranch: {
    title: "Commit to branch",
    description:
      "Commit a new title and Markdown content to a branch. `baseCommitId` must be the branch head.",
  },
  syncBranch: {
    title: "Sync branch",
    description:
      "Bring changes from a target line into a branch, optionally with a resolved title/content for conflicts. When the branch already has that result, no commit is created and the result reports `alreadyUpToDate`. Otherwise the result includes `commitId`.",
  },
  deleteBranch: {
    title: "Delete branch",
    description: "Delete a branch that has no open pull request.",
    destructive: true,
  },
  createPullRequest: {
    title: "Open pull request",
    description:
      "Propose merging a branch into a target line for review, optionally as a draft. Required reviews already open on the current specification are copied onto the pull request and returned as `reviews`. Optional reviews are not copied, and no review is added unless one was already required.",
  },
  setPullRequestDraft: {
    title: "Set pull request draft",
    description: "Mark a pull request as draft or ready for review.",
  },
  deletePullRequest: {
    title: "Close pull request",
    description:
      "Close and remove an unmerged pull request. Open discussions on it are resolved.",
    destructive: true,
  },
  requestPullRequestReview: {
    title: "Request pull request review",
    description:
      "Ask a reviewing discipline of the item's project (optionally one member of it) to review a pull request.",
  },
  decidePullRequest: {
    title: "Review pull request",
    description:
      "Approve, request changes or revoke a decision on a pull request review assigned to you or your discipline. Heads pin the reviewed content. The only member of an organization can approve their own changes; with more members, contributors cannot.",
    decision: true,
  },
  mergePullRequest: {
    title: "Merge pull request",
    description:
      "Merge an approved pull request; merging into main creates a new revision and the result includes `revisionId`. The only member of an organization can satisfy a required review of their own changes.",
    decision: true,
  },
  revertSpecification: {
    title: "Restore revision",
    description:
      "Create a new revision restoring the content of an earlier revision. History is never rewritten. A ready specification is protected: change it through a branch and pull request. The result includes `revisionId`.",
  },
  createSuggestion: {
    title: "Create suggestion",
    description:
      "Propose replacement Markdown for the specification with a title and rationale. Anyone in the organization can suggest; `open: false` saves a draft.",
  },
  updateSuggestion: {
    title: "Update suggestion",
    description:
      "Author only: change a suggestion's text, title or rationale. A content change supersedes earlier decisions.",
  },
  setSuggestionState: {
    title: "Set suggestion state",
    description: "Move a suggestion between draft, open and closed.",
  },
  setSuggestionReviewer: {
    title: "Set suggestion reviewer",
    description:
      "Author: assign or unassign a reviewer who holds a discipline in the project that can both edit specifications and review.",
  },
  decideSuggestion: {
    title: "Review suggestion",
    description:
      "Assigned reviewer: approve, request changes or revoke a decision on a suggestion version.",
    decision: true,
  },
  mergeSuggestion: {
    title: "Merge suggestion",
    description:
      "Assigned reviewer: apply an approved suggestion, creating the next revision.",
    decision: true,
  },
  requestReview: {
    title: "Request review",
    description:
      "Request a review of the current revision from a reviewing discipline of the item's project, optionally from one member, as required or optional. Requires request-reviews.",
  },
  cancelReview: {
    title: "Cancel review",
    description: "Cancel a pending review request.",
    destructive: true,
  },
  decideReview: {
    title: "Decide review",
    description:
      "Approve, request changes or revoke your decision on a review assigned to you or your discipline. Approval applies to `baseRevisionId`.",
    decision: true,
  },
  signOffReadinessCheck: {
    title: "Sign off readiness check",
    description:
      "Confirm (signedOff: true) or withdraw (false) a manual readiness check of an item for its current revision (`baseRevisionId`). `checkId` is the check's key in getWorkItem readiness. Only members of the check's disciplines can sign off; a new revision needs a new sign-off.",
    decision: true,
  },
  setAiPolicy: {
    title: "Set Lictory Intelligence policy",
    description:
      "Administrators: allow or forbid sending this organization's content to the AI provider.",
    decision: true,
  },
  requestAiReview: {
    title: "Request Lictory Intelligence review",
    description:
      "Queue a Lictory Intelligence review of the item's specification. Findings are proposals; nothing changes by itself.",
  },
  rerunAiAction: {
    title: "Rerun Lictory Intelligence review action",
    description:
      "Run the Lictory Intelligence review action of a pull request again.",
  },
  createAiCorrectivePr: {
    title: "Open Lictory Intelligence corrective pull request",
    description:
      "Open a pull request that applies chosen fixable findings of a Lictory Intelligence review, for human review.",
  },
  applyAiSuggestion: {
    title: "Apply Lictory Intelligence suggestion",
    description:
      "Commit one Lictory Intelligence finding's suggestion to its pull request's source branch.",
  },
  createTeam: {
    title: "Create team",
    description:
      "Project administrators: create a team, a group of people working on one vertical of the project. Teams own no configuration; items may have no team.",
  },
  updateTeam: {
    title: "Update team",
    description:
      "Project administrators: rename or describe a team, or archive/restore it. Archived teams stay on their items as history.",
  },
  setTeamMembership: {
    title: "Set team membership",
    description:
      "Project administrators: add or remove a team member. Adding someone also makes them a project member.",
  },
  setProjectType: {
    title: "Enable work item type",
    description:
      "Project administrators: enable or disable an organization work item type in the project. Disabling is refused while active items use it.",
  },
  createStatus: {
    title: "Create workflow status",
    description:
      "Project administrators: add a workflow status in a fixed category (backlog, unstarted, started, done, canceled).",
  },
  updateStatus: {
    title: "Update workflow status",
    description:
      "Project administrators: rename, recolor, recategorize or reorder a status.",
  },
  archiveStatus: {
    title: "Archive workflow status",
    description:
      "Project administrators: archive a status, moving its items to `replacementId`.",
    destructive: true,
  },
  createIteration: {
    title: "Create iteration",
    description:
      "Plan a sprint in a project that delivers in Lictory with manual sprints (project administrators or change-properties).",
  },
  updateIteration: {
    title: "Update iteration",
    description: "Change an iteration's name, goal or dates.",
  },
  startIteration: {
    title: "Start iteration",
    description: "Start a planned sprint; one iteration per project is active.",
  },
  completeIteration: {
    title: "Complete iteration",
    description:
      "Complete the active sprint, moving unfinished items to `carryOverTo` (or the backlog when null). The report is frozen.",
  },
  createType: {
    title: "Create work item type",
    description:
      "Organization administrators: add an organization-wide work item type with a hierarchy level and whether it carries a specification. It is enabled in every project.",
  },
  updateType: {
    title: "Update work item type",
    description:
      "Organization administrators: change or archive a work item type.",
  },
};

// Identifiers of entities a command creates are UUIDs chosen by the caller,
// which lets offline clients work optimistically. Agents may omit them: they
// are derived from the mutation id, so a retry with the same `mutationId`
// replays the same command instead of creating a duplicate.
function derivedId(mutationId: string, field: string) {
  const h = createHash("sha256").update(`${mutationId}:${field}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function commandSummary(
  ctx: CapabilityContext,
  organizationId: string,
  command: Record<string, unknown>,
) {
  const extra: Record<string, unknown> = {};
  const workItemId =
    typeof command.workItemId === "string" ? command.workItemId : undefined;
  const type = command.type;
  if (
    workItemId &&
    (type === "createWorkItem" ||
      type === "updateSpecification" ||
      type === "revertSpecification" ||
      type === "mergeSuggestion" ||
      type === "mergePullRequest")
  ) {
    const [row] = await ctx.db
      .select({ number: s.workItem.number, key: s.project.key })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.id, s.workItem.projectId),
          eq(s.project.organizationId, s.workItem.organizationId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      );
    if (row && type === "createWorkItem")
      extra.key = `${row.key}-${row.number}`;
    const [revision] = await ctx.db
      .select({ id: s.specificationRevision.id })
      .from(s.specificationRevision)
      .where(
        and(
          eq(s.specificationRevision.organizationId, organizationId),
          eq(s.specificationRevision.workItemId, workItemId),
        ),
      )
      .orderBy(desc(s.specificationRevision.number))
      .limit(1);
    if (revision) extra.revisionId = revision.id;
  }
  if (
    (type === "commitBranch" || type === "syncBranch") &&
    typeof command.branchId === "string"
  ) {
    const [branch] = await ctx.db
      .select({ headId: s.specificationBranch.headId })
      .from(s.specificationBranch)
      .where(
        and(
          eq(s.specificationBranch.organizationId, organizationId),
          eq(s.specificationBranch.id, command.branchId),
        ),
      );
    if (branch) {
      extra.commitId = branch.headId;
      if (type === "syncBranch" && branch.headId === command.sourceHeadId)
        extra.alreadyUpToDate = true;
    }
  }
  if (
    type === "mergePullRequest" &&
    typeof command.pullRequestId === "string"
  ) {
    const [pullRequest] = await ctx.db
      .select({
        mergedCommitId: s.specificationPullRequest.mergedCommitId,
      })
      .from(s.specificationPullRequest)
      .where(
        and(
          eq(s.specificationPullRequest.organizationId, organizationId),
          eq(s.specificationPullRequest.id, command.pullRequestId),
        ),
      );
    if (pullRequest?.mergedCommitId)
      extra.commitId = pullRequest.mergedCommitId;
  }
  if (
    type === "createPullRequest" &&
    typeof command.pullRequestId === "string"
  ) {
    extra.reviews = await ctx.db
      .select({
        id: s.pullRequestReview.id,
        disciplineId: s.pullRequestReview.disciplineId,
        userId: s.pullRequestReview.userId,
        required: s.pullRequestReview.required,
      })
      .from(s.pullRequestReview)
      .where(
        and(
          eq(s.pullRequestReview.organizationId, organizationId),
          eq(s.pullRequestReview.pullRequestId, command.pullRequestId),
        ),
      );
  }
  return extra;
}

function commandCapability(option: (typeof commandSchema.options)[number]) {
  const type = option.shape.type.value;
  const doc = commandDocs[type];
  const created: string[] = [];
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(option.shape)) {
    if (key === "type") continue;
    if (field instanceof z.ZodUUID) {
      created.push(key);
      shape[key] = field
        .optional()
        .describe("Identifier for the new entity. Omit to have one assigned.");
    } else shape[key] = field as z.ZodType;
  }
  const input = z.strictObject(
    {
      organizationId,
      mutationId: z
        .uuid()
        .optional()
        .describe(
          "Idempotency key. Retrying with the same value never applies the command twice.",
        ),
      ...shape,
    },
    {
      error: (issue) => {
        if (issue.code !== "unrecognized_keys") return undefined;
        const keys = issue.keys ?? [];
        const hint =
          type === "createWorkItem" && keys.includes("content")
            ? " Specification text belongs in `description`."
            : "";
        return `Unknown field(s): ${keys.join(", ")}.${hint}`;
      },
    },
  );
  return defineCapability({
    name: type,
    title: doc.title,
    description: doc.description,
    kind: "command",
    surfaces: everywhere,
    destructive: doc.destructive,
    decision: doc.decision,
    idempotent: true,
    input,
    async run(ctx, raw) {
      const { organizationId, mutationId, ...fields } = raw as {
        organizationId: string;
        mutationId?: string;
      } & Record<string, unknown>;
      const mutation = {
        protocol: PROTOCOL,
        id: mutationId ?? crypto.randomUUID(),
        organizationId,
        command: { type, ...fields } as Record<string, unknown>,
      };
      const ids: Record<string, string> = {};
      for (const key of created) {
        const value =
          (fields[key] as string | undefined) ?? derivedId(mutation.id, key);
        mutation.command[key] = value;
        ids[key] = value;
      }
      const result = await executeMutation(ctx, mutationSchema.parse(mutation));
      const summary = await commandSummary(
        ctx,
        organizationId,
        mutation.command,
      );
      return { mutationId: result.mutationId, ...ids, ...summary };
    },
  });
}

export const commandCapabilities: AnyCapability[] = commandSchema.options.map(
  (option) => commandCapability(option) as AnyCapability,
);

const syncDirectory = defineCapability({
  name: "syncDirectory",
  title: "Read directory",
  description: "The synchronized client's directory projection.",
  kind: "query",
  surfaces: webOnly,
  input: z.object({ organizationId: id.optional() }),
  run: (ctx, { organizationId }) =>
    directory(ctx.db, ctx.principal.userId, organizationId),
});

const listOrganizations = defineCapability({
  name: "listOrganizations",
  title: "List organizations",
  description:
    "Organizations you belong to, with your application role (admin or member). An organization owner is reported as admin. Start here to find an organizationId.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({}),
  async run(ctx) {
    const roster = await directory(ctx.db, ctx.principal.userId);
    return {
      organizations: roster.organizations.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: applicationRoleOf(o.role),
      })),
    };
  },
});

const getWorkspace = defineCapability({
  name: "getWorkspace",
  title: "Get workspace configuration",
  description:
    "The organization's projects (with their delivery settings, workflow statuses, enabled types, members, disciplines, teams and iterations), work item types, delivery targets and Lictory Intelligence policy, plus your application role and your capabilities in each project. Pass `projectId` to limit projects, statuses, teams, iterations, disciplines and delivery targets to that project. Organization roles are admin or member. Use it to resolve ids for other tools.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id
      .optional()
      .describe(
        "When set, the workspace is limited to this project. A missing project is not found.",
      ),
  }),
  async run(ctx, { organizationId, projectId }) {
    const roster = await directory(
      ctx.db,
      ctx.principal.userId,
      organizationId,
    );
    if (projectId && !roster.projects.some((p) => p.id === projectId))
      throw new CapabilityError("not_found", "This project is unavailable.");
    const scoped = projectId
      ? {
          ...roster,
          projects: roster.projects.filter((p) => p.id === projectId),
          projectMembers: roster.projectMembers.filter(
            (m) => m.projectId === projectId,
          ),
          disciplines: roster.disciplines.filter(
            (d) => d.projectId === projectId,
          ),
          teams: roster.teams.filter((t) => t.projectId === projectId),
          projectTypes: roster.projectTypes.filter(
            (t) => t.projectId === projectId,
          ),
          statuses: roster.statuses.filter((s) => s.projectId === projectId),
          iterations: roster.iterations.filter(
            (i) => i.projectId === projectId,
          ),
          readiness: roster.readiness.filter((r) => r.projectId === projectId),
          delivery: {
            ...roster.delivery,
            targets: roster.delivery.targets.filter(
              (t) => t.projectId === projectId,
            ),
          },
        }
      : roster;
    const me = scoped.members.find((m) => m.id === ctx.principal.userId);
    return {
      ...scoped,
      organizations: roster.organizations
        .filter((o) => o.id === organizationId)
        .map((o) => ({ ...o, role: applicationRoleOf(o.role) })),
      me: {
        userId: ctx.principal.userId,
        applicationRole: me?.role ?? "member",
        projects: scoped.projects.map((p) => ({
          projectId: p.id,
          role:
            scoped.projectMembers.find(
              (m) => m.projectId === p.id && m.userId === ctx.principal.userId,
            )?.role ?? null,
          capabilities: capabilitiesOf(
            scoped.disciplines,
            ctx.principal.userId,
            p.id,
          ),
        })),
      },
    };
  },
});

const searchMembersCapability = defineCapability({
  name: "searchMembers",
  title: "Search members",
  description: "Find organization members by name, email or handle.",
  kind: "query",
  surfaces: everywhere,
  input: memberSearchSchema,
  run: (ctx, q) =>
    searchMembers(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.q,
      q.offset,
      q.limit,
    ),
});

const searchEpicsCapability = defineCapability({
  name: "searchEpics",
  title: "Search epics",
  description: "Find parent-level work items in a project by title or key.",
  kind: "query",
  surfaces: everywhere,
  input: epicSearchSchema,
  run: (ctx, q) =>
    searchEpics(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.projectId,
      q.q,
      q.offset,
      q.limit,
    ),
});

const getIterationReport = defineCapability({
  name: "getIterationReport",
  title: "Get iteration report",
  description:
    "Burndown series, totals, frozen summary and recent velocity of an iteration.",
  kind: "query",
  surfaces: everywhere,
  input: iterationReportQuerySchema,
  run: (ctx, q) =>
    iterationReport(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.iterationId,
    ),
});

const getReadinessHistory = defineCapability({
  name: "getReadinessHistory",
  title: "Get Definition of Ready history",
  description:
    "Every version of a project's Definition of Ready (readiness checks per work item type), newest first. Version 0 stands for Lictory's defaults; types missing from `rules` use the defaults. Items that were ready or done when a version was published keep the checks they met; getWorkItem shows which version an item is evaluated under.",
  kind: "query",
  surfaces: everywhere,
  input: readinessHistoryQuerySchema,
  run: (ctx, q) =>
    readinessHistory(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.projectId,
    ),
});

const previewReadinessChecks = defineCapability({
  name: "previewReadinessChecks",
  title: "Preview a Definition of Ready",
  description:
    "What publishing these readiness rules would do to the project's items, without changing anything: how many ready or done items keep their version, which items would become ready, and which would need more work and why.",
  kind: "query",
  surfaces: everywhere,
  input: readinessPreviewQuerySchema,
  run: (ctx, q) =>
    readinessPreview(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
      q.projectId,
      q.rules,
    ),
});

type WorkItem = EntityOf<"workItem">;
async function bootstrap(
  ctx: CapabilityContext,
  scope: { organizationId: string; projectId?: string; workItemId?: string },
) {
  return readWorkspace(ctx.db, ctx.principal.userId, scope);
}
function keyOf(item: WorkItem, projects: { id: string; key: string }[]) {
  const project = projects.find((p) => p.id === item.projectId);
  return project ? `${project.key}-${item.number}` : String(item.number);
}

const listWorkItems = defineCapability({
  name: "listWorkItems",
  title: "List work items",
  description:
    "List work item summaries with derived review, thread, suggestion, readiness and child counts. Filter by project, team, type, status, assignee, refinement state or text in the title/key.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id.optional(),
    teamId: id.optional(),
    typeId: id.optional(),
    statusId: id.optional(),
    assigneeId: id
      .nullable()
      .optional()
      .describe("A member id, or null for unassigned items."),
    parentId: id.optional(),
    iterationId: id.optional(),
    refinementState: z.enum(refinementStates).optional(),
    query: z.string().max(120).optional(),
    includeArchived: z.boolean().default(false),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run(ctx, q) {
    const { entities, directory: roster } = await bootstrap(ctx, {
      organizationId: q.organizationId,
      projectId: q.projectId,
    });
    const text = q.query?.trim().toLowerCase();
    const items = entities
      .filter((e): e is WorkItem => e.type === "workItem")
      .filter(
        (i) =>
          (q.includeArchived || !i.archivedAt) &&
          (!q.teamId || i.teamId === q.teamId) &&
          (!q.typeId || i.typeId === q.typeId) &&
          (!q.statusId || i.statusId === q.statusId) &&
          (q.assigneeId === undefined || i.assigneeId === q.assigneeId) &&
          (!q.parentId || i.parentId === q.parentId) &&
          (!q.iterationId || i.iterationId === q.iterationId) &&
          (!q.refinementState || i.refinementState === q.refinementState) &&
          (!text ||
            i.title.toLowerCase().includes(text) ||
            keyOf(i, roster.projects).toLowerCase() === text),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    return {
      total: items.length,
      items: items
        .slice(q.offset, q.offset + q.limit)
        .map((i) => ({ key: keyOf(i, roster.projects), ...i })),
    };
  },
});

const getWorkItem = defineCapability({
  name: "getWorkItem",
  title: "Get work item",
  description:
    "A work item with its current specification (Markdown), readiness checks, reviews and approvals, discussions with messages, suggestions, branches, pull requests, relations, Lictory Intelligence runs and recent activity. Identify it by id or by key (e.g. PAY-142). Earlier revision contents are included only with includeRevisionContent.",
  kind: "query",
  surfaces: everywhere,
  input: z
    .object({
      organizationId,
      workItemId: id.optional(),
      key: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/)
        .optional(),
      includeRevisionContent: z.boolean().default(false),
      activityLimit: z.number().int().min(0).max(500).default(50),
    })
    .refine((q) => Boolean(q.workItemId) !== Boolean(q.key), {
      message: "Give exactly one of workItemId or key.",
    }),
  async run(ctx, q) {
    // Membership first: lookups below are only meaningful inside it.
    const roster = await directory(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
    );
    let row: { id: string; projectId: string } | undefined;
    if (q.key) {
      const [projectKey, number] = q.key.toUpperCase().split("-");
      const [found] = await ctx.db
        .select({
          id: s.workItem.id,
          projectId: s.project.id,
        })
        .from(s.project)
        .leftJoin(
          s.workItem,
          and(
            eq(s.workItem.projectId, s.project.id),
            eq(s.workItem.organizationId, s.project.organizationId),
            eq(s.workItem.number, Number(number)),
          ),
        )
        .where(
          and(
            eq(s.project.organizationId, q.organizationId),
            sql`upper(${s.project.key}) = ${projectKey}`,
          ),
        );
      if (!found)
        throw new CapabilityError("not_found", `${q.key} does not exist.`);
      if (!found.id)
        throw new CapabilityError(
          "not_found",
          "This work item is unavailable.",
        );
      row = { id: found.id, projectId: found.projectId };
    } else {
      const [found] = await ctx.db
        .select({ id: s.workItem.id, projectId: s.workItem.projectId })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, q.organizationId),
            eq(s.workItem.id, q.workItemId!),
          ),
        );
      if (!found)
        throw new CapabilityError(
          "not_found",
          "This work item is unavailable.",
        );
      row = found;
    }
    const { entities } = await bootstrap(ctx, {
      organizationId: q.organizationId,
      projectId: row.projectId,
      workItemId: row.id,
    });
    const item = entities.find(
      (e): e is WorkItem => e.type === "workItem" && e.id === row.id,
    )!;
    const own = entities.filter(
      (e) =>
        e.type !== "project" &&
        e.type !== "workItem" &&
        e.type !== "label" &&
        e.type !== "milestone" &&
        e.type !== "externalLink" &&
        e.type !== "relation",
    );
    const of = <T extends Entity["type"]>(type: T) =>
      (own as Entity[]).filter((e) => e.type === type) as EntityOf<T>[];
    const revisions = of("revision").sort((a, b) => b.number - a.number);
    const current = revisions.find((r) => r.id === item.revisionId);
    const messages = of("message");
    return {
      item: { key: keyOf(item, roster.projects), ...item },
      specification: current
        ? {
            revisionId: current.id,
            number: current.number,
            title: current.title,
            content: current.content,
          }
        : null,
      revisions: revisions.map((r) =>
        q.includeRevisionContent || r.id === current?.id
          ? r
          : { ...r, content: undefined },
      ),
      readiness: of("readiness")[0]?.checks ?? [],
      reviews: of("review"),
      assignments: of("assignment"),
      approvals: of("approval"),
      threads: of("thread").map((t) => ({
        ...t,
        messages: messages.filter((m) => m.threadId === t.id),
      })),
      suggestions: of("suggestion"),
      suggestionReviewers: of("suggestionReviewer"),
      suggestionDecisions: of("suggestionDecision"),
      branches: of("specBranch"),
      commits: of("specCommit"),
      pullRequests: of("pullRequest"),
      pullRequestReviews: of("prReview"),
      aiRuns: of("aiRun").map(({ model: _model, ...run }) => run),
      relations: entities.filter(
        (e) =>
          e.type === "relation" && (e.fromId === item.id || e.toId === item.id),
      ),
      children: entities
        .filter(
          (e): e is WorkItem => e.type === "workItem" && e.parentId === item.id,
        )
        .map((c) => ({
          id: c.id,
          key: keyOf(c, roster.projects),
          title: c.title,
          statusId: c.statusId,
          refinementState: c.refinementState,
        })),
      externalLinks: entities.filter(
        (e) => e.type === "externalLink" && e.workItemId === item.id,
      ),
      activity: of("activity")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(q.activityLimit ? -q.activityLimit : Infinity)
        .reverse(),
    };
  },
});

const getInsights = defineCapability({
  name: "getInsights",
  title: "Get insights",
  description:
    "Figures computed from the workspace, for questions about how work is going. topic `refinement`: specification refinement states, review progress, readiness checks and specifications that need attention. topic `delivery`: work by status, the active iteration's burndown and velocity, blocked or stalled work. topic `people`: workload per person and pending review requests. Narrow with projectId and teamId. The chat shows the result as cards; comment on it instead of repeating the numbers.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    topic: z.enum(insightTopics),
    projectId: id.optional(),
    teamId: id.optional(),
  }),
  async run(ctx, q) {
    const roster = await directory(
      ctx.db,
      ctx.principal.userId,
      q.organizationId,
    );
    const team = q.teamId
      ? roster.teams.find((t) => t.id === q.teamId)
      : undefined;
    if (q.teamId && !team)
      throw new CapabilityError("not_found", "The team is unavailable.");
    const projectId = q.projectId ?? team?.projectId;
    if (team && team.projectId !== projectId)
      throw new CapabilityError(
        "validation",
        "The team belongs to another project.",
      );
    const { entities, directory: scoped } = await bootstrap(ctx, {
      organizationId: q.organizationId,
      projectId,
    });
    const active =
      projectId && q.topic !== "refinement"
        ? scoped.iterations.find(
            (i) => i.projectId === projectId && i.state === "active",
          )
        : undefined;
    return computeInsights({
      topic: q.topic,
      entities,
      directory: scoped,
      projectId,
      teamId: q.teamId,
      now: new Date(),
      iteration: active
        ? {
            iteration: active,
            report: await iterationReport(
              ctx.db,
              ctx.principal.userId,
              q.organizationId,
              active.id,
            ),
          }
        : null,
    });
  },
});

const listLabels = defineCapability({
  name: "listLabels",
  title: "List labels",
  description:
    "Labels defined on a project. Archived labels are omitted unless includeArchived is true.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id,
    includeArchived: z.boolean().default(false),
  }),
  async run(ctx, q) {
    const { entities } = await bootstrap(ctx, {
      organizationId: q.organizationId,
      projectId: q.projectId,
    });
    return {
      labels: entities.filter(
        (e): e is EntityOf<"label"> =>
          e.type === "label" && (q.includeArchived || !e.archivedAt),
      ),
    };
  },
});

const listMilestones = defineCapability({
  name: "listMilestones",
  title: "List milestones",
  description:
    "Milestones defined on a project. Archived milestones are omitted unless includeArchived is true.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id,
    includeArchived: z.boolean().default(false),
  }),
  async run(ctx, q) {
    const { entities } = await bootstrap(ctx, {
      organizationId: q.organizationId,
      projectId: q.projectId,
    });
    return {
      milestones: entities.filter(
        (e): e is EntityOf<"milestone"> =>
          e.type === "milestone" && (q.includeArchived || !e.archivedAt),
      ),
    };
  },
});

export const workspaceCapabilities: AnyCapability[] = [
  listOrganizations,
  getWorkspace,
  listWorkItems,
  getWorkItem,
  listLabels,
  listMilestones,
  getInsights,
  searchMembersCapability,
  searchEpicsCapability,
  getIterationReport,
  getReadinessHistory,
  previewReadinessChecks,
  syncDirectory,
  ...commandCapabilities,
] as AnyCapability[];
