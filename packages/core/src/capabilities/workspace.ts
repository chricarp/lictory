import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { committedEvents } from "@lictory/core/lib/analytics/events";
import { deliveryIndex } from "@lictory/core/lib/work-items";
import {
  externalLinksByItem,
  lifecycleStage,
} from "@lictory/core/lib/lifecycle";
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
  iteration,
  pagePullRequest,
  refinement,
  review,
  specificationPullRequest,
  suggestion,
} from "@lictory/core/contracts/state-machines";
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
    {
      userId: ctx.principal.userId,
      surface: ctx.principal.surface,
      client: ctx.principal.client,
      agentId: ctx.principal.tokenId ?? null,
      agentName: ctx.principal.agentName ?? null,
    },
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
// and the type checker refuses a command without one. Sentences about which
// state allows a command come from its state machine (`rule`), the same
// table the command refuses from, so the two cannot disagree.
const commandDocs: Record<CommandType, CommandDoc> = {
  createSpace: {
    title: "Create space",
    description:
      "Create a space of nested knowledge pages. `slug` is its lowercase URL handle, unique among active spaces. `home` is {} (the organization), { projectId } or { projectId, teamId }. `accessMode` inherited (default: the home's members edit, every organization member views, named grants add) or restricted (only named grants; the creator receives edit). `publishing` direct (default: editors publish main's live draft) or reviewed (changes to main need reviewed pull requests).",
  },
  updateSpace: {
    title: "Update space",
    description:
      "Editors change a space's name, slug, description or icon. Changing its `home` or `publishing` policy is for the space's administrators (its creator, organization administrators and its home project's administrators). Requiring reviews is refused while a page has unpublished changes.",
  },
  setSpaceAccessMode: {
    title: "Set space access mode",
    description:
      "Space administrators: switch a space between inherited and restricted access. Restricting gives the person making the change an edit grant if they hold none; switching back keeps named grants. Recorded in the audit log.",
  },
  setSpaceGrant: {
    title: "Set space access",
    description:
      "Space administrators: give an organization member named access to a space (`level` view, comment or edit) or remove it (`level` null). In inherited spaces grants only add access. An administrator reads a restricted space only by granting themselves access, which is recorded in the audit log.",
  },
  archiveSpace: {
    title: "Archive space",
    description:
      "Space administrators: archive (archived: true) or restore a space. Archived spaces are read-only and free their handle; history is kept.",
    destructive: true,
  },
  createPage: {
    title: "Create page",
    description:
      "Editors of a space: create a page, optionally under `parentId` in the same space, placed between sibling pages `afterId` and `beforeId` (both omitted: last). The page starts with its title and an empty document as its first published commit on `main`.",
  },
  movePage: {
    title: "Move page",
    description:
      "Editors of a space: move a page under another page of the same space (`parentId`, null for the top level) between siblings `afterId` and `beforeId`. A page cannot move under its own subpages or to another space.",
  },
  archivePage: {
    title: "Archive page",
    description:
      "Editors of a space: archive (archived: true) a page with its subpages, or restore it with the subpages archived together with it. History is kept; nothing is deleted.",
  },
  createPageThread: {
    title: "Start page discussion",
    description:
      'Commenters (comment or edit access): start a discussion on a page with its first message. `anchor` is { v: 1, kind: "page" } (the whole page), { v: 1, kind: "commit", commitId, blockId, from, to, quote } (a range of one block of a commit, offsets into the block\'s text) or { v: 1, kind: "draft", draftId, epoch, start, end, quote } (base64 Yjs relative positions in the current epoch of one of the page\'s live drafts). `quote` is the selected text (at most 2000 characters). `branchId` names the line the discussion is about. `blocking` discussions block merging the page\'s changes until resolved. Mentions (@[label](mention:USER_ID)) notify people who can read the space.',
  },
  replyToPageThread: {
    title: "Reply to page discussion",
    description:
      "Commenters: reply to a page discussion. Messages are never edited or deleted. Mentions notify people who can read the space; earlier participants are told about the reply.",
  },
  resolvePageThread: {
    title: "Resolve page discussion",
    description:
      "Commenters: resolve a page discussion. Every message is kept and the event is recorded in the page's activity.",
    decision: true,
  },
  reopenPageThread: {
    title: "Reopen page discussion",
    description:
      "Commenters: reopen a resolved page discussion. The event is recorded in the page's activity. Refused for a discussion of a closed pull request (kind `invalid_state`): start a new discussion on the page instead.",
    decision: true,
  },
  setPageThreadBlocking: {
    title: "Mark page discussion blocking",
    description:
      "Commenters: mark a page discussion blocking (it blocks merging the page's changes while open) or non-blocking. Recorded in the page's activity. A discussion of a closed pull request cannot be marked blocking.",
    decision: true,
  },
  commitDraft: {
    title: "Commit page draft",
    description:
      "Seal the live draft of a page line (`branchId`, its `draftId` and `epoch`) at exactly `expectedSequence`, the stored sequence the editor last saw, into an immutable commit with an optional `message`. The commit's title is the draft's working title at that cut; `title` applies only when the draft has no working title of its own. Later edits stay uncommitted. On main in a Direct space this publishes the page. Allowed for editors of the space; a named branch only for its author and collaborators; main in a Reviewed space is protected (use proposePageChange or a branch and pull request). Edits that cancel out record the cut without a commit (`nothingToCommit`). Agents cannot type into live drafts; they propose changes with proposePageChange.",
    decision: true,
  },
  restorePageCommit: {
    title: "Restore page version",
    description:
      "Create a new commit on a line (`branchId`, at `expectedHead`) with the title and content of an earlier commit of the page; history is never rewritten, and the line's live draft starts again from the new commit. Refused while the draft has uncommitted changes unless `discardDraftChanges` is true (the stored edits stay recoverable). Main of a Reviewed space is restored through a branch and pull request.",
  },
  createPageBranch: {
    title: "Create page branch",
    description:
      "Editors of a space: create a named branch of a page from main's latest commit or `fromCommitId`, with its own live draft. The author and the collaborators they invite edit it. Names follow Git's branch rules; `main` is reserved. `origin` { workItemId, revisionId } records the work item revision the branch documents (“Propose page update”), kept after the branch is merged or deleted.",
  },
  setPageBranchCollaborator: {
    title: "Set page branch collaborator",
    description:
      "The branch author: invite (`collaborator: true`) or remove a person who can edit the space as a collaborator on a page branch.",
  },
  deletePageBranch: {
    title: "Delete page branch",
    description:
      "The branch author or an editor of the space: delete a page branch that no unmerged pull request uses. Its editors are disconnected; its commits stay in the page's history. Every discussion written on the branch (open or resolved, blocking or not) is permanently deleted with its messages; the branch's `discussionsOnDelete` says how many. When there are any, pass that total as `discussionsToRemove`: the deletion is refused without it or when it changed. To continue, create a new branch from its last commit.",
    destructive: true,
  },
  syncPageBranch: {
    title: "Update page branch",
    description:
      'Bring the changes of main (or `fromBranchId`) into a page branch with a merge commit; `expectedHead` and `expectedTargetHead` name the heads you inspected. Refused while the branch has uncommitted changes. When both lines changed the same blocks or the title, the command is refused with kind `page_merge_conflicts`: read the conflicts with previewPageMerge and send `resolutions` keyed by conflict id ("ours", "theirs", "both" or { manual: blocks }; the title conflict takes "ours", "theirs" or { title }). Returns `commitId`, or `alreadyUpToDate`.',
  },
  createPagePullRequest: {
    title: "Open page pull request",
    description:
      "Propose merging a page branch into main (default) or `targetBranchId`, optionally as a draft. Request reviews with requestPageReview; in Reviewed spaces merging into main needs at least one required review.",
  },
  updatePagePullRequest: {
    title: "Update page pull request",
    description: `The author or a source branch collaborator: change a page pull request's title or description, or mark it draft or ready for review. ${pagePullRequest.rule("edit", "markDraft", "markReady")}`,
  },
  deletePagePullRequest: {
    title: "Close page pull request",
    description: `The author or an editor of the space: close an unmerged page pull request. Its reviews and discussions are kept; open discussions on it are resolved and recorded. ${pagePullRequest.rule("close")} A closed pull request is not reopened: open a new one from the branch.`,
    destructive: true,
  },
  requestPageReview: {
    title: "Request page review",
    description: `Ask someone with comment or edit access to review a page pull request; \`required\` reviews gate the merge. People who contributed to the change cannot approve it. The reviewer is notified. ${pagePullRequest.rule("requestReview")}`,
  },
  cancelPageReview: {
    title: "Cancel page review request",
    description:
      "Withdraw a review request from a page pull request (reviewers may decline their own).",
  },
  decidePagePullRequest: {
    title: "Review page pull request",
    description: `Approve, request changes on, or revoke your decision on a page pull request. The decision binds to the complete merge result of \`inspectedSourceHead\` and \`inspectedTargetHead\`; any later change makes it stale, and a stale decision is no longer yours to revoke. Contributors to the change cannot approve it. Refused while the merge has conflicts. ${pagePullRequest.rule("review")}`,
    decision: true,
  },
  mergePagePullRequest: {
    title: "Merge page pull request",
    description:
      "Merge an open page pull request whose heads you inspected. Requires no conflicts, no uncommitted draft changes on either line, no open blocking discussions (of the pull request or its source branch, or of the page when merging into main), no current request for changes and every required reviewer's approval of the current result; Reviewed spaces also need at least one required review to merge into main. Merging into main publishes a commit that records the valid approvals and deletes the source branch unless another pull request uses it. Merging permanently deletes the discussions of the source branch and of the pull request (open or resolved, blocking or not; `mergeability.onMerge` says how many and whether the source is deleted); when there are any, pass that total as `discussionsToRemove`: the merge is refused without it or when it changed; `deletesSourceBranch` likewise confirms `onMerge.sourceRetired`. Discussions on the target and other branches are kept. Returns `commitId`.",
    decision: true,
  },
  proposePageChange: {
    title: "Propose page change",
    description:
      "Propose a new version of a page without publishing it: creates a branch from main, a commit with `title` and the new content (`markdown`, GitHub-flavoured, or canonical Tiptap JSON `content`) and an open pull request into main titled by the first line of `message`. People review and merge it. `origin` { workItemId, revisionId } records the work item revision the change documents (“Propose page update” from an item), so the item lists the proposal. Returns `branchId`, `commitId`, `pullRequestId` and `draftId` (the branch's live draft).",
  },
  attachPage: {
    title: "Attach page to work item",
    description:
      "Attach a page to a work item as context: `purpose` background, design or runbook, optionally pinned to one version (`commitId` from listPageCommits; omitted: the published page). Needs change-properties in the item's project and read access to the page; attaching never gives the item's readers access to the page, and only people who can read the page see the attachment. Attaching an attached page with another purpose or pin replaces the attachment. Returns `attachmentId`. Reverse with detachPage.",
  },
  detachPage: {
    title: "Detach page from work item",
    description:
      "Remove a page attachment from a work item (`attachmentId` from getWorkItemKnowledge). Needs change-properties in the item's project and read access to the page. The attachment's history is kept in the page's activity; attach the page again to restore it.",
  },
  linkContextPage: {
    title: "Link context page",
    description:
      "Keep a page as context of a project (board and backlog), one of its teams (`teamId`) or one of its iterations (`iterationId`: goals, notes, retrospectives), placed between the context pages `afterId` and `beforeId` of that list (both omitted: last). Project administrators and members whose discipline changes item properties manage context pages; the page must be readable by you, and only its readers see the link. Returns `linkId`. Reverse with unlinkContextPage.",
  },
  unlinkContextPage: {
    title: "Unlink context page",
    description:
      "Remove a context page from its project, team or iteration list (`linkId` from listContextPages). The page itself is unchanged; link it again to restore it.",
  },
  moveContextPage: {
    title: "Reorder context page",
    description:
      "Move a context page between two others of the same list (`afterId`, `beforeId`; null for an open end).",
  },
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
      "Project administrators: publish the next version of the project's Definition of Ready. `rules` maps a work item type id to its complete list of checks; types left out use Lictory's defaults. Check kinds: specification, no_blocking_threads, reviews_requested, reviews_approved, children_ready (each at most once per type), section (`heading` must exist and not be empty), discipline_approval (`disciplineIds` approved the current revision), intelligence_review (an automated check, never an approval: the latest Lictory Intelligence review of the item analysed its current revision and found no finding at or above `severity`, `blocker` or `major`; at most once per type and only beside reviews_approved, discipline_approval or manual; a person can override it per revision with signOffReadinessCheck) and manual (a named sign-off by someone in `disciplineIds`, or anyone holding a discipline when empty). `baseRevisionId` is the current version id from getWorkspace (null while the project uses the defaults). Use previewReadinessChecks first. Items that are ready or done keep the checks they met; every other item moves to the new checks and becomes ready when they pass.",
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
      "Create a work item (Epic, Story, Task, Bug, Subtask or a custom type enabled in the project). Spec-backed types require edit-specifications; plain types require edit-specifications or change-properties in the project. `teamId` is optional. `typeId` and `teamId` come from getWorkspace; `description` is Markdown and becomes the first revision. Unknown fields are rejected. Specification text belongs in `description`, not `content`. Set an estimate afterwards with updateWorkItem. `source` { pageId, commitId, blockId?, quote? } records committed page content the item is created from (you must be able to read the page; the commit must be one of its versions, the block one of that version's top-level blocks, the quote at most 2000 characters); only readers of the page see it. The result includes `key` and `revisionId`.",
  },
  updateWorkItem: {
    title: "Update work item properties",
    description: `Change non-material properties: status, refinement state (${refinement.targets("move").join(", ")}; \`ready\` is derived from readiness checks), type, team (or null), priority, assignee, parent, milestone, iteration, estimate, labels. An estimate must be one of the project's scale (Fibonacci, linear, or T-shirt points). Moving a ready item back is rejected while its readiness checks still pass. Never creates a revision or stales approvals. Requires change-properties in the item's project.`,
  },
  acceptDeliveryScope: {
    title: "Accept delivery scope",
    description:
      "Accept the current specification revision for native delivery. Requires change-properties and the exact baseRevisionId. Records the agreed revision, applies the project's readiness policy and moves unselected backlog work to an unstarted status when available. Later revisions remain proposed delivery scope until explicitly accepted. External delivery scope is accepted by publishing instead.",
    decision: true,
  },
  recordDecision: {
    title: "Record refinement decision",
    description:
      "Record an agreed conclusion with title and body against a specification revision. Optionally cite a resolved specification discussion using sourceThreadId; its original revision is retained. Requires a discipline that edits specifications or reviews. This records a conclusion, never approves a specification or resolves a discussion.",
    decision: true,
  },
  setDecisionArchived: {
    title: "Archive or restore decision",
    description:
      "Archive or restore a recorded conclusion. Requires edit-specifications in the project, or, for your own decision, a discipline that edits specifications or reviews; authorship alone grants nothing. The original text, revision and history are retained.",
    decision: true,
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
      "Save a new revision of an item's title and Markdown specification before main is protected. `baseRevisionId` must be current (getWorkItem); a stale base is rejected. Material changes stale approvals. Requires edit-specifications. Prefer createBranch, commitBranch and createPullRequest for reviewed changes; protected main always requires a pull request.",
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
      "Commit a title, Markdown content and optional proposedChildren to a branch. Each entry is a new child (stable workItemId, typeId, title, description) or a change to an existing direct child (changeId, workItemId, base {revisionId, title} read from the child, then title/description for children without a specification, parentId to move it (null detaches), or archive: true). Entries apply only after reviewed merge into main; a change applies only while the child still has its base revision and is not accepted, underway or handed off. Omit proposedChildren to preserve the base breakdown; supply the complete list when editing it. Entries already accepted in main must stay unchanged. `baseCommitId` identifies the inspected base; concurrent nonoverlapping changes combine and conflicts require explicit resolution.",
  },
  openSpecificationDraft: {
    title: "Open specification draft",
    description:
      "Open the shared live draft of a specification line that people edit together in the browser: main (omit `branchId`; needs edit-specifications while main is not protected) or a branch (its author and collaborators). Creates it from the line's latest Markdown, or reopens a closed one; returns `draftId`, `epoch` and `documentName`. `discardChanges: true` starts the draft again from the line's latest Markdown for everyone editing it (the discarded edits stay recoverable on the server). Agents cannot type into live drafts; they change specifications with updateSpecification or a branch commit.",
  },
  commitSpecificationDraft: {
    title: "Save specification draft",
    description:
      "Seal the live draft of a specification line (`draftId`, `epoch`) at exactly `expectedSequence`, the stored sequence the editor last saw: on main a new revision (`message` is its change summary; existing approvals are marked outdated and reviews re-requested, as for updateSpecification), on a branch a commit (`message` is the commit message; optional `proposedChildren` made from `breakdownBaseCommitId`). The content is what the server stored, never sent. Edits that cancel out record the cut without a revision or commit. Main of a protected specification is refused.",
    decision: true,
  },
  syncBranch: {
    title: "Sync branch",
    description:
      "Bring changes from a target line into a branch, optionally with a resolved title/content for conflicts. When the branch already includes the target history and has that result, no commit is created and the result reports `alreadyUpToDate`. Otherwise the result includes `commitId`.",
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
    description: `Mark a pull request as draft or ready for review. ${specificationPullRequest.rule("markDraft", "markReady")}`,
  },
  deletePullRequest: {
    title: "Close pull request",
    description: `Close a pull request and remove it from the item. Open discussions on it are resolved. The text of a merged pull request stays in the specification. ${specificationPullRequest.rule("close")}`,
    destructive: true,
  },
  requestPullRequestReview: {
    title: "Request pull request review",
    description: `Ask a reviewing discipline of the item's project (optionally one member of it) to review a pull request. ${specificationPullRequest.rule("requestReview")}`,
  },
  decidePullRequest: {
    title: "Review pull request",
    description: `Approve, request changes or revoke a decision on a pull request review assigned to you or your discipline. Heads pin the reviewed content. The only member of an organization can approve their own changes; with more members, contributors cannot. ${specificationPullRequest.rule("review")}`,
    decision: true,
  },
  mergePullRequest: {
    title: "Merge pull request",
    description: `Merge an approved pull request; merging into main creates a new revision and the result includes \`revisionId\`. The only member of an organization can satisfy a required review of their own changes. ${specificationPullRequest.rule("merge")}`,
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
      "Legacy: propose replacement Markdown for the specification with a title and rationale. New proposals use createBranch, commitBranch and createPullRequest instead. Anyone in the organization can suggest; `open: false` saves a draft.",
  },
  updateSuggestion: {
    title: "Update suggestion",
    description: `Author only: change a suggestion's text, title or rationale. A content change supersedes earlier decisions. ${suggestion.rule("update")}`,
  },
  setSuggestionState: {
    title: "Set suggestion state",
    description: `Move a suggestion between draft, open and closed. ${suggestion.rule("returnToDraft", "openForReview", "close")} A merged suggestion never changes state.`,
  },
  setSuggestionReviewer: {
    title: "Set suggestion reviewer",
    description:
      "Author: assign or unassign a reviewer who holds a discipline in the project that can both edit specifications and review.",
  },
  decideSuggestion: {
    title: "Review suggestion",
    description: `Assigned reviewer: approve, request changes or revoke a decision on a suggestion version. ${suggestion.rule("review")}`,
    decision: true,
  },
  mergeSuggestion: {
    title: "Merge suggestion",
    description: `Assigned reviewer: apply an approved suggestion, creating the next revision. ${suggestion.rule("merge")}`,
    decision: true,
  },
  requestReview: {
    title: "Request review",
    description:
      "Request a review of the current revision from a reviewing discipline of the item's project, optionally from one member, as required or optional. Requires request-reviews.",
  },
  cancelReview: {
    title: "Cancel review",
    description: `Cancel a review request, decided or not. ${review.rule("cancel")}`,
    destructive: true,
  },
  decideReview: {
    title: "Decide review",
    description: `Approve, request changes or revoke your decision on a review assigned to you or your discipline. Approval applies to \`baseRevisionId\`. ${review.rule("approve", "requestChanges", "revoke")}`,
    decision: true,
  },
  signOffReadinessCheck: {
    title: "Sign off readiness check",
    description:
      "Confirm (signedOff: true) or withdraw (false) a manual readiness check of an item for its current revision (`baseRevisionId`). `checkId` is the check's key in getWorkItem readiness. Only members of the check's disciplines can sign off; a new revision needs a new sign-off. On a Lictory Intelligence check (intelligence_review) signing off overrides the automated result for that revision; anyone holding a discipline in the project may do so, only on the person's explicit instruction.",
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
    description: `Start a planned sprint; one iteration per project is active. ${iteration.rule("start")}`,
  },
  completeIteration: {
    title: "Complete iteration",
    description: `Complete the active sprint, moving unfinished items to \`carryOverTo\` (or the backlog when null). The report is frozen. ${iteration.rule("complete")}`,
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
      return { mutationId: result.mutationId, ...ids, ...result.summary };
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
  humanOnly: {
    reason: "browser",
    where: "Loaded automatically by the signed-in browser",
    alternative: "listOrganizations and getWorkspace",
  },
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
  title: "Search parent items",
  description:
    "Find parent work items in a project by title or key. Pass childTypeId to search every type strictly above the child's hierarchy level; without it, search top-level types.",
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
      q.childTypeId,
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
    "List work item summaries with review, readiness, child counts and lifecycle stage. Filter by project, team, type, local status/assignee, refinement state, lifecycle stage or title/key. lifecycle=ready means ready for delivery (checks pass) and excludes accepted, active and completed work, active delivery and completed work. External delivery facts come from the provider link; use lifecycle for cross-mode progress.",
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
    lifecycle: z
      .enum([
        "proposal",
        "refinement",
        "review",
        "ready",
        "committed",
        "underway",
        "completed",
        "canceled",
      ])
      .optional(),
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
    const delivery = deliveryIndex(roster);
    const links = externalLinksByItem(entities, roster.delivery.targets);
    const stageOf = (item: WorkItem) =>
      lifecycleStage(
        item,
        roster.projects.find((p) => p.id === item.projectId)!,
        delivery,
        links.get(item.id),
      );
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
          (!q.lifecycle || stageOf(i) === q.lifecycle) &&
          (!text ||
            i.title.toLowerCase().includes(text) ||
            keyOf(i, roster.projects).toLowerCase() === text),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    return {
      total: items.length,
      items: items.slice(q.offset, q.offset + q.limit).map((i) => ({
        key: keyOf(i, roster.projects),
        ...i,
        lifecycle: stageOf(i),
        externalDelivery: links.get(i.id) ?? null,
      })),
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
      decisions: of("decision"),
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
