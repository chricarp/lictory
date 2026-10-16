import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../db/schema";
import { committedEvents } from "../lib/analytics/events";
import { computeInsights, insightTopics } from "../intelligence/insights";
import {
  createSyncService,
  directory,
  iterationReport,
  searchEpics,
  searchMembers,
} from "../sync/server/service";
import {
  PROTOCOL,
  applicationRoleOf,
  capabilitiesOf,
  checkpointSchema,
  commandSchema,
  epicSearchSchema,
  iterationReportQuerySchema,
  memberSearchSchema,
  mutationSchema,
  refinementStates,
  scopeSchema,
  type Command,
  type Entity,
  type EntityOf,
  type Mutation,
} from "../sync/shared/protocol";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
} from "./core";

// Commands that can queue Lictory Intelligence runs.
const aiTriggers = new Set<Command["type"]>([
  "requestAiReview",
  "rerunAiAction",
  "createAiCorrectivePr",
  "applyAiSuggestion",
  "commitBranch",
  "syncBranch",
  "createPullRequest",
  "setPullRequestDraft",
]);

// The single write path for workspace commands, whichever surface issued
// them: the domain service authorizes, applies, logs changes and records the
// idempotency receipt in one transaction; then shared side effects run.
export async function executeMutation(
  ctx: CapabilityContext,
  mutation: Mutation,
) {
  const service = createSyncService(ctx.db, {
    onMutationCommitted: (userId, committed, snapshots) => {
      for (const event of committedEvents(
        committed.command,
        snapshots.before,
        snapshots.after,
        snapshots.directory,
      ))
        ctx.effects.track(
          event.event,
          {
            ...event.properties,
            organization_id: committed.organizationId,
            mutation_id: committed.id,
            ...(ctx.principal.surface === "web"
              ? {}
              : { surface: ctx.principal.surface }),
          },
          `${committed.organizationId}:${committed.id}:${String(event.properties.work_item_id ?? "")}`,
        );
    },
  });
  const result = await service.mutate(ctx.principal.userId, mutation);
  if (aiTriggers.has(mutation.command.type)) ctx.effects.aiRunsQueued();
  return result;
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
      "Create a work item (Epic, Story, Task, Bug, Subtask or a custom type enabled in the project). Spec-backed types require edit-specifications; plain types require edit-specifications or change-properties in the project. `teamId` is optional. `typeId` and `teamId` come from getWorkspace; `description` is Markdown and becomes the first revision.",
  },
  updateWorkItem: {
    title: "Update work item properties",
    description:
      "Change non-material properties: status, refinement state (draft, refinement, in_review; `ready` is derived from readiness checks), type, team (or null), priority, assignee, parent, milestone, iteration, estimate, labels. Never creates a revision or stales approvals. Requires change-properties in the item's project.",
  },
  rankWorkItem: {
    title: "Rank work item",
    description:
      "Move an item in backlog/board order between two neighbours (null = open end).",
  },
  addRelation: {
    title: "Add relation",
    description:
      "Link two work items: blocks, relates or duplicates (from this item to `toId`).",
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
      "Archive (archived: true) or restore (archived: false) a work item. History is kept.",
  },
  updateSpecification: {
    title: "Revise specification",
    description:
      "Save a new revision of an item's title and Markdown specification. `baseRevisionId` must be the current revision (getWorkItem); a stale base is rejected with the current revision id. Material changes can stale approvals. Requires edit-specifications. Prefer createSuggestion when others should review the change.",
  },
  createThread: {
    title: "Start discussion",
    description:
      "Start a discussion thread anchored to a section (and optionally a quoted range) of a revision, a suggestion, a pull request or a commit. `blocking` threads block readiness until resolved.",
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
      "Start a named line of work on a specification, from the main line or another branch.",
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
      "Bring changes from a target line into a branch, optionally with a resolved title/content for conflicts.",
  },
  deleteBranch: {
    title: "Delete branch",
    description: "Delete a branch that has no open pull request.",
    destructive: true,
  },
  createPullRequest: {
    title: "Open pull request",
    description:
      "Propose merging a branch into a target line for review, optionally as a draft.",
  },
  setPullRequestDraft: {
    title: "Set pull request draft",
    description: "Mark a pull request as draft or ready for review.",
  },
  deletePullRequest: {
    title: "Close pull request",
    description: "Close and remove an unmerged pull request.",
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
      "Approve, request changes or revoke a decision on a pull request review assigned to you or your discipline. Heads pin the reviewed content.",
    decision: true,
  },
  mergePullRequest: {
    title: "Merge pull request",
    description:
      "Merge an approved pull request; merging into main creates a new revision.",
    decision: true,
  },
  revertSpecification: {
    title: "Restore revision",
    description:
      "Create a new revision restoring the content of an earlier revision. History is never rewritten.",
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
  const input = z.object({
    organizationId,
    mutationId: z
      .uuid()
      .optional()
      .describe(
        "Idempotency key. Retrying with the same value never applies the command twice.",
      ),
    ...shape,
  });
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
      return { mutationId: result.mutationId, cursor: result.cursor, ...ids };
    },
  });
}

export const commandCapabilities: AnyCapability[] = commandSchema.options.map(
  (option) => commandCapability(option) as AnyCapability,
);

// Browser clients submit fully formed mutations from their durable queue.
const applyMutation = defineCapability({
  name: "applyMutation",
  title: "Apply workspace mutation",
  description: "Apply a queued workspace mutation from a synchronized client.",
  kind: "command",
  surfaces: webOnly,
  idempotent: true,
  input: mutationSchema,
  run: (ctx, mutation) => executeMutation(ctx, mutation),
});

const syncRead = defineCapability({
  name: "syncRead",
  title: "Synchronize workspace",
  description:
    "Read a scope's bootstrap snapshot or the changes after a checkpoint.",
  kind: "query",
  surfaces: webOnly,
  input: z.object({
    scope: scopeSchema,
    cursor: checkpointSchema.optional(),
  }),
  run: (ctx, { scope, cursor }) =>
    createSyncService(ctx.db).read(ctx.principal.userId, scope, cursor),
});

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
    "Organizations you belong to, with your application role (owner/admin/member). Start here to find an organizationId.",
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
    "The organization's projects (with their delivery settings, workflow statuses, enabled types, members, disciplines, teams and iterations), work item types, delivery targets and Lictory Intelligence policy, plus your application role and your capabilities in each project. Use it to resolve ids for other tools.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  async run(ctx, { organizationId }) {
    const roster = await directory(
      ctx.db,
      ctx.principal.userId,
      organizationId,
    );
    const me = roster.members.find((m) => m.id === ctx.principal.userId);
    return {
      ...roster,
      organizations: roster.organizations.filter(
        (o) => o.id === organizationId,
      ),
      me: {
        userId: ctx.principal.userId,
        applicationRole: me?.role ?? "member",
        projects: roster.projects.map((p) => ({
          projectId: p.id,
          role:
            roster.projectMembers.find(
              (m) => m.projectId === p.id && m.userId === ctx.principal.userId,
            )?.role ?? null,
          capabilities: capabilitiesOf(
            roster.disciplines,
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

type WorkItem = EntityOf<"workItem">;
async function bootstrap(
  ctx: CapabilityContext,
  scope: { organizationId: string; projectId?: string; workItemId?: string },
) {
  const page = await createSyncService(ctx.db).read(
    ctx.principal.userId,
    scope,
  );
  return {
    entities: page.changes.flatMap((c) =>
      c.operation === "upsert" ? [c.entity] : [],
    ),
    directory: page.directory,
  };
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
    let where;
    if (q.key) {
      const [projectKey, number] = q.key.toUpperCase().split("-");
      const project = roster.projects.find((p) => p.key === projectKey);
      if (!project)
        throw new CapabilityError("unavailable", `${q.key} does not exist.`);
      where = and(
        eq(s.workItem.organizationId, q.organizationId),
        eq(s.workItem.projectId, project.id),
        eq(s.workItem.number, Number(number)),
      );
    } else
      where = and(
        eq(s.workItem.organizationId, q.organizationId),
        eq(s.workItem.id, q.workItemId!),
      );
    const [row] = await ctx.db
      .select({ id: s.workItem.id, projectId: s.workItem.projectId })
      .from(s.workItem)
      .where(where);
    if (!row)
      throw new CapabilityError(
        "unavailable",
        "This work item is unavailable.",
      );
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
      aiRuns: of("aiRun"),
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
      throw new CapabilityError("unavailable", "The team is unavailable.");
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

export const workspaceCapabilities: AnyCapability[] = [
  listOrganizations,
  getWorkspace,
  listWorkItems,
  getWorkItem,
  getInsights,
  searchMembersCapability,
  searchEpicsCapability,
  getIterationReport,
  syncRead,
  syncDirectory,
  applyMutation,
  ...commandCapabilities,
] as AnyCapability[];
