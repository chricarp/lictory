import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { GitMerge, MoreHorizontal, Pencil, FileEdit, X } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@lictory/platform/components/spaces/menu";
import { useMemo, useState } from "react";
import type {
  PageMergeBlocker,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
import { Checkbox } from "@lictory/ui/checkbox";
import { mergeDocuments } from "@lictory/core/spaces/document/merge";
import { canonicalizeDocument } from "@lictory/core/spaces/document/canonical";
import { documentToMarkdown } from "@lictory/core/spaces/document/markdown";
import { Actor } from "@lictory/platform/components/identity/actor";
import { PullRequestHeader } from "@lictory/platform/components/review/pull-request-header";
import {
  MergeBox,
  MergedNotice,
  type MergeRequirement,
} from "@lictory/platform/components/review/merge-box";
import { DocumentDiff, RenderedDocumentDiff } from "./document-diff";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { usePageWork } from "@lictory/platform/components/spaces/work/page-work";
import { discussionTotal } from "@lictory/core/spaces/discussion-lifecycle";
import { pagePullRequest } from "@lictory/core/contracts/state-machines";
import {
  ActionError,
  ChoosePerson,
  Confirmation,
  CountsChanged,
  DiscussionRemovalWarning,
  field,
  sameCounts,
  useHistoryAction,
} from "./shared";
import { useMergePreview } from "./preview";
import { ConflictResolution } from "./conflicts";

type PullRequest = SpaceEntityOf<"pagePullRequest">;

// A reviewed change goes to someone by default: whoever wrote the target
// line's latest version, or else the page's latest other author (not me);
// "" asks nobody yet. The pull request form and the branch's "Commit and
// send for review" offer the same person.
export function suggestReviewer(
  branches: readonly SpaceEntityOf<"pageBranch">[],
  commits: readonly SpaceEntityOf<"pageCommit">[],
  userId: string,
  targetBranchId?: string,
) {
  const targetBranch =
    branches.find((b) => b.id === targetBranchId) ??
    branches.find((b) => b.isMain);
  const lastAuthor = commits.find(
    (c) => c.id === targetBranch?.headCommitId,
  )?.authorId;
  const otherAuthor = commits.findLast((c) => c.authorId !== userId)?.authorId;
  return lastAuthor && lastAuthor !== userId ? lastAuthor : (otherAuthor ?? "");
}
const blockerLabels: Record<PageMergeBlocker, string> = {
  draft: "Mark this pull request ready for review",
  no_merge_base:
    "No single common version. Restore the wanted version on a new branch",
  conflicts: "Resolve conflicts on the source branch",
  no_changes: "No changes remain to merge",
  uncommitted_source: "Commit or discard live changes on the source branch",
  uncommitted_target: "Commit or discard live changes on the target branch",
  blocking_threads: "Resolve blocking discussions",
  no_required_review: "Request at least one required review",
  review_pending: "Required reviewers must approve the current result",
  changes_requested: "Address the requested changes and ask for review again",
};
export function PullRequests({
  pageId,
  initialSource,
  selected,
  onSelect,
}: {
  pageId: string;
  // A branch to open the pull request from (?source=, after a commit).
  initialSource?: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { pullRequests, branches, commits } = usePageHistory(pageId);
  const { origins } = usePageWork(pageId);
  const { userId, directory } = useWorkspace();
  const space = useSpace();
  const { canEdit } = usePageActions();
  const [source, setSource] = useState(initialSource ?? "");
  const [target, setTarget] = useState("");
  // The title a branch opened from a work item was named with ("Propose
  // page update"), offered as its pull request's title.
  const initialTitle =
    origins.find((o) => o.branchId === initialSource)?.title ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [offered, setOffered] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const suggestedReviewer = suggestReviewer(branches, commits, userId, target);
  // In a reviewed space nothing merges without a required review: say so
  // while a ready pull request would be opened with nobody asked.
  const needsReviewer = space.publishing === "reviewed" && !draft;
  const [reviewer, setReviewer] = useState<string | null>(null);
  const chosenReviewer = reviewer ?? suggestedReviewer;
  const action = useHistoryAction();
  const pr = pullRequests.find((p) => p.id === selected);
  if (pr)
    return (
      <PullRequestDetail key={pr.id} pr={pr} onBack={() => onSelect(null)} />
    );
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Pull requests</h2>
      {pullRequests.length === 0 && (
        <p className="text-sm text-muted-foreground">No pull requests</p>
      )}
      <ul className="space-y-2">
        {pullRequests.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="w-full rounded-xl border p-4 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect(p.id)}
            >
              <span className="font-medium">{p.title}</span>
              <span className="ml-2 text-xs capitalize">{p.status}</span>
              {p.reviewers.some((r) => r.userId === userId) && (
                <span className="ml-2 text-xs">Your review requested</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="space-y-3 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const id = crypto.randomUUID();
            void action.run(
              {
                type: "createPagePullRequest",
                pageId,
                pullRequestId: id,
                sourceBranchId: source,
                ...(target ? { targetBranchId: target } : {}),
                title,
                description,
                draft,
              },
              () => {
                if (chosenReviewer)
                  void action.run({
                    type: "requestPageReview",
                    pullRequestId: id,
                    userId: chosenReviewer,
                    required: true,
                  });
                onSelect(id);
                setTitle("");
                setReviewer(null);
              },
            );
          }}
        >
          <h3 className="font-medium">Create pull request</h3>
          <label className="block text-sm">
            Source branch
            <DropdownSelect
              required
              className="w-full"
              value={source}
              onValueChange={(value) => {
                setSource(value);
                const named =
                  origins.find((o) => o.branchId === value)?.title ?? "";
                // Never over what the person typed themselves.
                if (!title.trim() || title === offered) setTitle(named);
                setOffered(named);
              }}
              placeholder="Choose branch"
            >
              <DropdownSelectOption value="">
                Choose branch
              </DropdownSelectOption>
              {branches
                .filter(
                  (b) =>
                    !b.isMain &&
                    (b.authorId === userId ||
                      b.collaboratorIds.includes(userId)),
                )
                .map((b) => (
                  <DropdownSelectOption key={b.id} value={b.id}>
                    {b.name}
                  </DropdownSelectOption>
                ))}
            </DropdownSelect>
          </label>
          <label className="block text-sm">
            Target branch
            <DropdownSelect
              className="w-full"
              value={target}
              onValueChange={(value) => setTarget(value)}
            >
              <DropdownSelectOption value="">main</DropdownSelectOption>
              {branches
                .filter((b) => !b.isMain && b.id !== source)
                .map((b) => (
                  <DropdownSelectOption key={b.id} value={b.id}>
                    {b.name}
                  </DropdownSelectOption>
                ))}
            </DropdownSelect>
          </label>
          <label className="block text-sm">
            Title
            <Input
              required
              maxLength={200}
              className={`${field} mt-1`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <Textarea
              maxLength={20000}
              className={`${field} mt-1`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Reviewer
            <DropdownSelect
              className="mt-1 w-full"
              value={chosenReviewer}
              onValueChange={(value) => setReviewer(value)}
            >
              <DropdownSelectOption value="">
                {space.publishing === "reviewed"
                  ? "Choose a reviewer"
                  : "No review"}
              </DropdownSelectOption>
              {directory.members
                .filter((m) => m.id !== userId)
                .map((m) => (
                  <DropdownSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </DropdownSelectOption>
                ))}
            </DropdownSelect>
          </label>
          {needsReviewer && !chosenReviewer && (
            <p role="status" className="text-xs text-warning">
              Merging needs a review. Choose a reviewer or start as draft.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft}
              onCheckedChange={(checked) => setDraft(checked === true)}
            />
            Start as draft
          </label>
          <ActionError error={action.error} />
          <Button
            type="submit"
            disabled={action.pending || !source || !title.trim()}
          >
            Create pull request
          </Button>
        </form>
      )}
    </section>
  );
}
function PullRequestDetail({
  pr,
  onBack,
}: {
  pr: PullRequest;
  onBack: () => void;
}) {
  // `loaded`: the server has answered, so the discussions a merge warns
  // about are current, not what this browser cached on an earlier visit.
  const { commits, reviews, branches, loaded } = usePageHistory(pr.pageId);
  const { userId, memberName } = useWorkspace();
  const { canEdit } = usePageActions();
  const space = useSpace();
  const gate = pr.mergeability;
  const { preview, error, reload } = useMergePreview(
    { pullRequestId: pr.id },
    `${gate?.sourceHeadId}:${gate?.targetHeadId}`,
    pr.status !== "merged",
  );
  const action = useHistoryAction();
  const [resolve, setResolve] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(pr.title);
  const [description, setDescription] = useState(pr.description ?? "");
  const [closing, setClosing] = useState(false);
  type OnMerge = NonNullable<PullRequest["mergeability"]>["onMerge"];
  // Open while confirming, with what the merge removes as it was shown.
  const [merging, setMerging] = useState<{ onMerge: OnMerge } | null>(null);
  // After a cancelled merge, focus returns to the merge button.
  const [returnFocus, setReturnFocus] = useState(false);
  const target = commits.find((c) => c.id === preview?.theirs.headCommitId);
  const resultDocument = useMemo(() => {
    const base = commits.find((c) => c.id === preview?.baseCommitId);
    const source = commits.find((c) => c.id === preview?.ours.headCommitId);
    if (!base || !source || !target || !preview || preview.conflicts.length)
      return null;
    const result = mergeDocuments({
      base: canonicalizeDocument(base.content),
      ours: canonicalizeDocument(source.content),
      theirs: canonicalizeDocument(target.content),
    });
    // The server owns the result. Only show this reconstruction when it agrees
    // with the inspected preview, preserving canonical rich references.
    return result.status === "clean" &&
      documentToMarkdown(result.document) === preview.markdown
      ? result.document
      : null;
  }, [commits, preview, target]);
  const fresh =
    preview &&
    gate?.sourceHeadId &&
    preview.ours.headCommitId === gate.sourceHeadId &&
    preview.theirs.headCommitId === gate.targetHeadId;
  const inspected = preview
    ? {
        inspectedSourceHead: preview.ours.headCommitId,
        inspectedTargetHead: preview.theirs.headCommitId,
      }
    : null;
  const canReview =
    pagePullRequest.allows(pr.status, "review") &&
    fresh &&
    preview.resultHash &&
    !preview.conflicts.length &&
    !gate.contributorIds.includes(userId);
  const editable = canEdit || pr.authorId === userId;
  const currentReviews = reviews.filter(
    (r) => r.pullRequestId === pr.id && !r.withdrawnAt,
  );
  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.name ?? "the branch";
  const sourceName = branchName(pr.sourceBranchId);
  const targetName = branchName(pr.targetBranchId);
  const requested = pr.reviewers.some((r) => r.userId === userId);
  const decided = currentReviews.some((r) => r.reviewerId === userId);
  const approvedBy = currentReviews
    .filter((r) => !r.staleAt && r.decision === "approved")
    .map((r) => memberName(r.reviewerId));
  const blockerText = (b: PageMergeBlocker) =>
    b === "blocking_threads"
      ? `Resolve ${gate!.blockingThreads} blocking discussion${gate!.blockingThreads === 1 ? "" : "s"}.`
      : b === "review_pending"
        ? `Waiting for ${
            pr.reviewers
              .filter(
                (r) =>
                  r.required &&
                  !currentReviews.some(
                    (review) =>
                      review.reviewerId === r.userId &&
                      !review.staleAt &&
                      review.decision === "approved",
                  ),
              )
              .map((r) => memberName(r.userId))
              .join(", ") || "required reviewers"
          } to approve this exact result.`
        : b === "uncommitted_source" || b === "uncommitted_target"
          ? `Commit or discard live changes on branch ${branches.find((branch) => branch.id === (b === "uncommitted_source" ? pr.sourceBranchId : pr.targetBranchId))?.name ?? "in this proposal"}.`
          : `${blockerLabels[b]}.`;
  const reviewBlockers: PageMergeBlocker[] = [
    "no_required_review",
    "review_pending",
    "changes_requested",
  ];
  // The same requirement rows as a specification's and a code pull
  // request's merge box: what blocks, then what is already met.
  const requirements: MergeRequirement[] = gate
    ? [
        ...gate.blockers.map((b): MergeRequirement => ({
          key: b,
          state:
            b === "review_pending" || b === "draft" ? "pending" : "failure",
          text: blockerText(b),
        })),
        ...(reviewBlockers.some((b) => gate.blockers.includes(b))
          ? []
          : [
              {
                key: "reviews",
                state: "success" as const,
                text: approvedBy.length
                  ? `Approved by ${approvedBy.join(", ")}.`
                  : "No review is required to merge.",
              },
            ]),
        ...(gate.blockers.includes("blocking_threads")
          ? []
          : [
              {
                key: "threads",
                state: "success" as const,
                text: "No blocking discussions.",
              },
            ]),
        ...(gate.blockers.includes("conflicts") ||
        gate.blockers.includes("no_merge_base")
          ? []
          : [
              {
                key: "conflicts",
                state: "success" as const,
                text: `No conflicts with ${targetName}.`,
              },
            ]),
      ]
    : [];
  const menu = editable && pagePullRequest.allows(pr.status, "edit") && (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Pull request actions"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </MenuTrigger>
      <MenuContent width={220} aria-label="Pull request actions">
        <MenuItem icon={<Pencil />} onSelect={() => setEditing(!editing)}>
          Edit details
        </MenuItem>
        <MenuItem
          icon={<FileEdit />}
          onSelect={() => {
            if (!action.pending)
              void action.run({
                type: "updatePagePullRequest",
                pullRequestId: pr.id,
                draft: pagePullRequest.allows(pr.status, "markDraft"),
              });
          }}
        >
          {pagePullRequest.allows(pr.status, "markReady")
            ? "Ready for review"
            : "Mark as draft"}
        </MenuItem>
        <MenuItem icon={<X />} onSelect={() => setClosing(true)}>
          Close pull request…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PullRequestHeader
          title={pr.title}
          state={pr.status}
          author={<Actor userId={pr.authorId} size={20} />}
          mergedBy={
            pr.mergedById && pr.mergedById !== pr.authorId ? (
              <Actor userId={pr.mergedById} size={20} />
            ) : undefined
          }
          base={targetName}
          head={sourceName}
          className="flex-1"
        />
        {menu}
      </div>
      {pr.description && <Markdown source={pr.description} />}
      <ActionError error={action.error || error} />
      {error && (
        <Button variant="secondary" onClick={reload}>
          Reload preview
        </Button>
      )}
      {editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              {
                type: "updatePagePullRequest",
                pullRequestId: pr.id,
                title,
                description,
              },
              () => setEditing(false),
            );
          }}
        >
          <label className="block text-sm">
            Title
            <Input
              className={field}
              value={title}
              required
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <Textarea
              className={field}
              value={description}
              maxLength={20000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={action.pending}>
            Save details
          </Button>
        </form>
      )}
      {closing && (
        <div className="rounded-xl border p-3 text-sm">
          <p>Close this pull request? Open discussions will be resolved.</p>
          <Button
            size="sm"
            disabled={action.pending}
            onClick={() => {
              void action.run(
                { type: "deletePagePullRequest", pullRequestId: pr.id },
                onBack,
              );
            }}
          >
            Confirm close
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClosing(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 space-y-6">
          {pr.status === "merged" ? (
            <MergedNotice>
              Merged by {memberName(pr.mergedById ?? pr.authorId)}.
            </MergedNotice>
          ) : (
            gate && (
              <MergeBox
                target={targetName}
                requirements={requirements}
                blocked={gate.blockers.length > 0 || !fresh || !loaded}
                note={
                  !canEdit
                    ? "Merging needs edit access to this space."
                    : gate.blockers.length
                      ? `Resolve the requirement${gate.blockers.length === 1 ? "" : "s"} above to merge.`
                      : `Merging publishes this result as the new version of ${targetName}.`
                }
                action={
                  canEdit &&
                  !merging && (
                    <Button
                      size="sm"
                      disabled={
                        action.pending ||
                        !loaded ||
                        !fresh ||
                        !inspected ||
                        gate.blockers.length > 0
                      }
                      autoFocus={returnFocus}
                      onFocus={() => setReturnFocus(false)}
                      onClick={() => {
                        setReturnFocus(false);
                        setMerging({ onMerge: gate.onMerge });
                      }}
                    >
                      <GitMerge aria-hidden className="size-3.5" /> Merge pull
                      request…
                    </Button>
                  )
                }
              >
                {canEdit && merging && (
                  <MergeConfirmation
                    sourceName={sourceName}
                    targetName={targetName}
                    onMerge={merging.onMerge}
                    changed={!sameCounts(merging.onMerge, gate.onMerge)}
                    disabled={
                      action.pending ||
                      !fresh ||
                      !inspected ||
                      gate.blockers.length > 0 ||
                      !sameCounts(merging.onMerge, gate.onMerge)
                    }
                    onConfirm={() => {
                      if (inspected)
                        void action.run(
                          {
                            type: "mergePagePullRequest",
                            pullRequestId: pr.id,
                            ...inspected,
                            ...(merging.onMerge
                              ? {
                                  discussionsToRemove: discussionTotal(
                                    merging.onMerge.discussions,
                                  ),
                                  deletesSourceBranch:
                                    merging.onMerge.sourceRetired,
                                }
                              : {}),
                          },
                          () => setMerging(null),
                        );
                    }}
                    onCancel={() => {
                      setMerging(null);
                      setReturnFocus(true);
                    }}
                  />
                )}
              </MergeBox>
            )
          )}
          {pr.status !== "merged" && (
            <section aria-label="Resulting document diff" className="space-y-4">
              <h3 className="font-semibold">Resulting changes</h3>
              {!preview && !error && (
                <p role="status">Loading resulting changes…</p>
              )}
              {preview?.title && !preview.conflicts.length && target && (
                <>
                  <DocumentDiff before={target.title} after={preview.title} />
                  {resultDocument ? (
                    <RenderedDocumentDiff
                      before={target.content}
                      after={resultDocument}
                      beforeLabel="Current"
                      afterLabel="Proposed"
                    />
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      Comparison unavailable. Reload the preview.
                    </p>
                  )}
                </>
              )}
              {Boolean(preview?.conflicts.length) && (
                <>
                  <p className="text-sm">
                    Conflicts must be resolved on the source branch before
                    review.
                  </p>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      onClick={() => setResolve(true)}
                    >
                      Resolve conflicts
                    </Button>
                  )}
                </>
              )}
            </section>
          )}
        </div>
        {/* Reviewers beside the change, like a specification's pull
            request: who is asked, where each stands, and the decision for
            whoever is asked. */}
        <aside
          aria-label="Reviewers"
          className="space-y-3 text-sm xl:sticky xl:top-6"
        >
          <h3 className="text-[13px] font-semibold">Reviewers</h3>
          {!pr.reviewers.length && (
            <p className="text-[13px] text-muted-foreground">
              {space.publishing === "reviewed"
                ? "Nobody is asked yet. Merging needs a required reviewer’s approval."
                : "Nobody is asked yet."}
            </p>
          )}
          {pr.reviewers.map((r) => {
            const review = currentReviews.find(
              (review) => review.reviewerId === r.userId,
            );
            const state = review?.staleAt
              ? "Outdated"
              : review?.decision === "approved"
                ? "Approved"
                : review
                  ? "Changes requested"
                  : "Pending";
            return (
              <div
                key={r.userId}
                className="flex items-start gap-2 text-[13px]"
              >
                <Actor userId={r.userId} label="none" size={20} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="truncate font-medium">
                      {memberName(r.userId)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {r.required ? "Required" : "Optional"}
                    </span>
                    <span
                      className={`ml-auto text-xs ${state === "Approved" ? "text-success" : "text-muted-foreground"}`}
                    >
                      {state}
                    </span>
                  </p>
                  {r.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      requested{" "}
                      <time
                        dateTime={r.createdAt}
                        title={absoluteTime(r.createdAt)}
                      >
                        {relativeTime(r.createdAt)}
                      </time>
                    </p>
                  )}
                  {review?.staleReason && (
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={review.staleReason}
                    >
                      {review.staleReason}
                    </p>
                  )}
                  {editable && pr.status !== "merged" && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      aria-label={`Cancel request for ${memberName(r.userId)}`}
                      disabled={action.pending}
                      onClick={() => {
                        void action.run({
                          type: "cancelPageReview",
                          pullRequestId: pr.id,
                          userId: r.userId,
                        });
                      }}
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {currentReviews
            .filter(
              (r) =>
                !pr.reviewers.some(
                  (requested) => requested.userId === r.reviewerId,
                ),
            )
            .map((r) => (
              <p key={r.id} className="text-[13px]">
                {memberName(r.reviewerId)}:{" "}
                {r.staleAt
                  ? r.decision === "approved"
                    ? "Approved an earlier result"
                    : "Requested changes on an earlier result"
                  : r.decision === "approved"
                    ? "Approved this result"
                    : "Changes requested"}
              </p>
            ))}
          {editable && pr.status !== "merged" && (
            <ChoosePerson
              label={
                pr.reviewers.length ? "Add reviewer" : "Request required review"
              }
              onSelect={(id) => {
                void action.run({
                  type: "requestPageReview",
                  pullRequestId: pr.id,
                  userId: id,
                  required: true,
                });
              }}
            />
          )}
          {/* The decision is offered to those asked (and to anyone who
              already decided), so the next step reads clearly. */}
          {pagePullRequest.allows(pr.status, "review") &&
            (requested || decided) &&
            !gate?.contributorIds.includes(userId) && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {(["approve", "request_changes", "revoke"] as const)
                  .filter(
                    (decision) =>
                      decision !== "revoke" ||
                      // A decision made stale by a later change is no longer
                      // current: the server has nothing to revoke.
                      currentReviews.some(
                        (r) => r.reviewerId === userId && !r.staleAt,
                      ),
                  )
                  .map((decision) => (
                    <Button
                      key={decision}
                      size="sm"
                      variant={decision === "approve" ? "primary" : "secondary"}
                      disabled={
                        action.pending ||
                        !inspected ||
                        (decision !== "revoke" && !canReview)
                      }
                      onClick={() => {
                        if (inspected)
                          void action.run({
                            type: "decidePagePullRequest",
                            pullRequestId: pr.id,
                            decision,
                            ...inspected,
                          });
                      }}
                    >
                      {decision === "approve"
                        ? "Approve"
                        : decision === "request_changes"
                          ? "Request changes"
                          : "Revoke decision"}
                    </Button>
                  ))}
              </div>
            )}
          {gate?.contributorIds.includes(userId) && (
            <p className="text-xs text-muted-foreground">
              Contributors cannot approve their own changes.
            </p>
          )}
        </aside>
      </div>
      {resolve && (
        <ConflictResolution
          branchId={pr.sourceBranchId}
          fromBranchId={pr.targetBranchId}
          onClose={() => {
            setResolve(false);
            reload();
          }}
        />
      )}
    </section>
  );
}

// Asked before merging: what happens to the source branch and which
// discussions the merge deletes (docs/internals/spaces.md#when-a-line-ends).
function MergeConfirmation({
  sourceName,
  targetName,
  onMerge,
  changed,
  disabled,
  onConfirm,
  onCancel,
}: {
  sourceName: string;
  targetName: string;
  onMerge: NonNullable<PullRequest["mergeability"]>["onMerge"];
  changed: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const removes = !onMerge || discussionTotal(onMerge.discussions) > 0;
  return (
    <Confirmation
      label="Confirm merge"
      className="space-y-3 rounded-xl border border-destructive/40 bg-card p-3 text-sm"
    >
      <p className="font-medium">
        Merge {sourceName} into {targetName}?
      </p>
      {onMerge && (
        <p>
          {onMerge.sourceRetired
            ? `Branch ${sourceName} will be deleted after the merge.`
            : `Branch ${sourceName} stays available after the merge.`}
        </p>
      )}
      <DiscussionRemovalWarning
        where={`${sourceName} and this pull request`}
        counts={onMerge?.discussions}
      />
      {changed && <CountsChanged />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={onConfirm}>
          {removes ? "Merge and delete discussions" : "Confirm merge"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Confirmation>
  );
}
