import { useMemo, useState } from "react";
import type {
  PageMergeBlocker,
  SpaceEntityOf,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { mergeDocuments } from "@lictory/core/spaces/document/merge";
import { canonicalizeDocument } from "@lictory/core/spaces/document/canonical";
import { documentToMarkdown } from "@lictory/core/spaces/document/markdown";
import { Avatar } from "@lictory/ui/avatar";
import { DocumentDiff, RenderedDocumentDiff } from "./document-diff";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { ActionError, ChoosePerson, field, useHistoryAction } from "./shared";
import { useMergePreview } from "./preview";
import { ConflictResolution } from "./conflicts";

type PullRequest = SpaceEntityOf<"pagePullRequest">;
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
  selected,
  onSelect,
}: {
  pageId: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { pullRequests, branches } = usePageHistory(pageId);
  const { userId } = useWorkspace();
  const { canEdit } = usePageActions();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
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
        <p className="text-sm text-muted-foreground">
          No pull requests yet. Propose a change from a branch.
        </p>
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
                onSelect(id);
                setTitle("");
              },
            );
          }}
        >
          <h3 className="font-medium">Create pull request</h3>
          <label className="block text-sm">
            Source branch
            <select
              required
              className={`${field} mt-1`}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">Choose branch</option>
              {branches
                .filter(
                  (b) =>
                    !b.isMain &&
                    (b.authorId === userId ||
                      b.collaboratorIds.includes(userId)),
                )
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            Target branch
            <select
              className={`${field} mt-1`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">main</option>
              {branches
                .filter((b) => !b.isMain && b.id !== source)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            Title
            <input
              required
              maxLength={200}
              className={`${field} mt-1`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
              maxLength={20000}
              className={`${field} mt-1`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft}
              onChange={(e) => setDraft(e.target.checked)}
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
  const { commits, reviews, branches } = usePageHistory(pr.pageId);
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
    pr.status === "open" &&
    fresh &&
    preview.resultHash &&
    !preview.conflicts.length &&
    !gate.contributorIds.includes(userId);
  const editable = canEdit || pr.authorId === userId;
  const currentReviews = reviews.filter(
    (r) => r.pullRequestId === pr.id && !r.withdrawnAt,
  );
  return (
    <section className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        Back to pull requests
      </Button>
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight break-words">
          {pr.title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="mr-2 inline-flex rounded-full bg-muted px-2.5 py-1 font-medium text-foreground capitalize">
            {pr.status}
          </span>{" "}
          {branches.find((b) => b.id === pr.sourceBranchId)?.name ??
            "Source branch"}{" "}
          →{" "}
          {branches.find((b) => b.id === pr.targetBranchId)?.name ??
            "Target branch"}{" "}
          · {memberName(pr.authorId)}
        </p>
      </header>
      <Markdown source={pr.description ?? "No description provided."} />
      <ActionError error={action.error || error} />
      {error && (
        <Button variant="secondary" onClick={reload}>
          Reload preview
        </Button>
      )}
      {editable && pr.status !== "merged" && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-full px-3 py-2 font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            Manage pull request
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(!editing)}
            >
              Edit details
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={action.pending}
              onClick={() => {
                void action.run({
                  type: "updatePagePullRequest",
                  pullRequestId: pr.id,
                  draft: pr.status !== "draft",
                });
              }}
            >
              {pr.status === "draft" ? "Ready for review" : "Return to draft"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
              Close pull request…
            </Button>
          </div>
        </details>
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
            <input
              className={field}
              value={title}
              required
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <textarea
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
          <p>
            Close this pull request? Open discussions will be resolved and their
            history retained.
          </p>
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
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
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
                      beforeLabel={`${preview.theirs.name} · current`}
                      afterLabel="Proposed result"
                    />
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      The document comparison is unavailable. Reload the preview
                      to try again.
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
        <aside
          aria-label="Review summary"
          className="space-y-5 rounded-2xl border border-transparent bg-muted/35 p-5 ring-1 ring-border xl:sticky xl:top-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Review summary</h3>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${pr.status === "merged" || gate?.blockers.length === 0 ? "bg-success/10 text-success" : "bg-muted text-foreground"}`}
            >
              {pr.status === "merged"
                ? "Merged"
                : gate?.blockers.length === 0
                  ? "Ready to merge"
                  : pr.status === "draft"
                    ? "Draft"
                    : gate?.blockers.includes("conflicts")
                      ? "Conflicts to resolve"
                      : "Awaiting review"}
            </span>
          </div>
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Reviewers</h3>
            <p className="text-sm text-muted-foreground">
              {space.publishing === "reviewed"
                ? "Approval is required for this exact result."
                : "Required reviews must approve this exact result."}
            </p>
            {!pr.reviewers.length && (
              <p className="text-sm text-muted-foreground">
                No reviewers requested yet.
              </p>
            )}
            {pr.reviewers.map((r) => (
              <div
                key={r.userId}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Avatar
                  name={memberName(r.userId)}
                  userId={r.userId}
                  size="md"
                />
                <span>
                  {memberName(r.userId)} ·{" "}
                  {r.required ? "Required" : "Optional"}
                </span>
                {!currentReviews.some(
                  (review) => review.reviewerId === r.userId && !review.staleAt,
                ) &&
                  pr.status !== "merged" && (
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      Pending
                    </span>
                  )}
                {editable && pr.status !== "merged" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() => {
                      void action.run({
                        type: "cancelPageReview",
                        pullRequestId: pr.id,
                        userId: r.userId,
                      });
                    }}
                  >
                    Cancel review request
                  </Button>
                )}
              </div>
            ))}
            {currentReviews.map((r) => (
              <p key={r.id} className="text-sm">
                {memberName(r.reviewerId)}:{" "}
                {r.staleAt
                  ? r.decision === "approved"
                    ? "Approved an earlier result"
                    : "Requested changes on an earlier result"
                  : r.decision === "approved"
                    ? "Approved this result"
                    : "Changes requested"}
                {r.staleReason && (
                  <span className="block text-xs text-muted-foreground">
                    {r.staleReason}
                  </span>
                )}
              </p>
            ))}
            {editable && pr.status !== "merged" && (
              <ChoosePerson
                label="Request required review"
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
            {pr.status === "open" && !gate?.contributorIds.includes(userId) && (
              <div className="flex flex-wrap gap-2">
                {(["approve", "request_changes", "revoke"] as const)
                  .filter(
                    (decision) =>
                      decision !== "revoke" ||
                      currentReviews.some((r) => r.reviewerId === userId),
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
          </section>
          {gate && (
            <section className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">Merge checks</h3>
              <ul className="space-y-2 text-sm">
                {gate.blockers.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 text-muted-foreground"
                    >
                      ○
                    </span>
                    <span>
                      {b === "blocking_threads"
                        ? `Resolve ${gate.blockingThreads} blocking discussion(s)`
                        : b === "review_pending"
                          ? `Requires approval from ${
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
                            }`
                          : b === "uncommitted_source" ||
                              b === "uncommitted_target"
                            ? `Commit or discard live changes on branch ${branches.find((branch) => branch.id === (b === "uncommitted_source" ? pr.sourceBranchId : pr.targetBranchId))?.name ?? "in this proposal"}`
                            : blockerLabels[b]}
                    </span>
                  </li>
                ))}
              </ul>
              {!gate.blockers.length && (
                <p className="text-sm">
                  <span aria-hidden="true" className="mr-2 text-success">
                    ✓
                  </span>
                  All merge checks pass.
                </p>
              )}
              {canEdit && (
                <Button
                  className="w-full"
                  disabled={
                    action.pending ||
                    !fresh ||
                    !inspected ||
                    gate.blockers.length > 0
                  }
                  onClick={() => {
                    if (inspected)
                      void action.run({
                        type: "mergePagePullRequest",
                        pullRequestId: pr.id,
                        ...inspected,
                      });
                  }}
                >
                  Merge pull request
                </Button>
              )}
            </section>
          )}
          {pr.status === "merged" && (
            <p className="text-sm">
              Merged by {memberName(pr.mergedById ?? pr.authorId)}. The merged
              version is available in history.
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
