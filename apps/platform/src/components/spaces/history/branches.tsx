import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useId, useState } from "react";
import { GitBranch, GitPullRequest } from "lucide-react";
import { StatusChip } from "@lictory/ui/status-chip";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
import { Input } from "@ui-sdk/react/input";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { usePageBranchSelection } from "./branch-selection";
import {
  discussionTotal,
  type DiscussionCounts,
} from "@lictory/core/spaces/discussion-lifecycle";
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
import { ConflictResolution } from "./conflicts";

export function Branches({ pageId }: { pageId: string }) {
  // `loaded`: the server has answered, so the counts a deletion warns about
  // are current, not what this browser cached on an earlier visit.
  const { branches, commits, pullRequests, loaded } = usePageHistory(pageId);
  const { userId, memberName } = useWorkspace();
  const { canEdit } = usePageActions();
  const { branch, setBranch } = usePageBranchSelection();
  const [name, setName] = useState("");
  // Main is "Current main version" whether or not its head was already
  // loaded when this mounted; only another selected line names its head.
  const [from, setFrom] = useState(
    branch && !branch.isMain ? branch.headCommitId : "",
  );
  const [sync, setSync] = useState<string>();
  // The branch being deleted and the counts its confirmation shows.
  const [deleting, setDeleting] = useState<{
    id: string;
    counts: DiscussionCounts | undefined;
  }>();
  // After a cancelled deletion, focus returns to that branch's button.
  const [returnTo, setReturnTo] = useState<string>();
  const action = useHistoryAction();
  const problemId = useId();
  const problem =
    branchNameProblem(name) ??
    (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())
      ? "That branch name is already in use."
      : null);
  // Open pull requests by source branch, for the list's chips.
  const openPull = new Map(
    pullRequests
      .filter((p) => p.status !== "merged")
      .map((p) => [p.sourceBranchId, p]),
  );
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="font-semibold">Branches</h2>
        <p className="text-[13px] leading-5 text-muted-foreground">
          A branch is a working copy of this page for preparing a change without
          touching the published version; a pull request asks for it to be
          reviewed and published.
        </p>
      </div>
      <ActionError error={action.error} />
      {/* One scannable row per line: its name, who started it, whether a
          review is open, and the actions on it. */}
      <div className="divide-y rounded-xl border bg-card">
        {branches.map((b) => {
          const current = branch ? branch.id === b.id : b.isMain;
          const pull = openPull.get(b.id);
          return (
            <section key={b.id} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <GitBranch
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <h3 className="truncate font-medium">{b.name}</h3>
                    {b.isMain && (
                      <StatusChip tone="neutral">Published version</StatusChip>
                    )}
                    {pull && (
                      <StatusChip tone="attention" icon={<GitPullRequest />}>
                        In review: {pull.title}
                      </StatusChip>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created by {memberName(b.authorId)}
                    {b.draft?.uncommittedChanges
                      ? " · Uncommitted live changes"
                      : ""}
                    {b.collaboratorIds.length > 0 &&
                      ` · Collaborators: ${b.collaboratorIds.map(memberName).join(", ")}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {current ? (
                    <span className="px-2 text-xs text-muted-foreground">
                      Showing
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Open ${b.name}`}
                      onClick={() => setBranch(b.isMain ? null : b.id)}
                    >
                      Open
                    </Button>
                  )}
                  {canEdit &&
                    !b.isMain &&
                    (b.authorId === userId ||
                      b.collaboratorIds.includes(userId)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSync(b.id)}
                      >
                        Sync from main
                      </Button>
                    )}
                  {canEdit && !b.isMain && b.authorId === userId && (
                    <ChoosePerson
                      label="Add collaborator"
                      variant="ghost"
                      onSelect={(id) => {
                        void action.run({
                          type: "setPageBranchCollaborator",
                          branchId: b.id,
                          userId: id,
                          collaborator: true,
                        });
                      }}
                    />
                  )}
                  {canEdit &&
                    b.authorId === userId &&
                    b.collaboratorIds.map((id) => (
                      <Button
                        key={id}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void action.run({
                            type: "setPageBranchCollaborator",
                            branchId: b.id,
                            userId: id,
                            collaborator: false,
                          });
                        }}
                      >
                        Remove {memberName(id)}
                      </Button>
                    ))}
                  {canEdit && !b.isMain && deleting?.id !== b.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={!loaded}
                      autoFocus={returnTo === b.id}
                      onFocus={() => {
                        if (returnTo === b.id) setReturnTo(undefined);
                      }}
                      onClick={() => {
                        setReturnTo(undefined);
                        setDeleting({
                          id: b.id,
                          counts: b.discussionsOnDelete,
                        });
                      }}
                    >
                      Delete branch…
                    </Button>
                  )}
                </div>
              </div>
              {deleting?.id === b.id && (
                <Confirmation
                  label={`Delete branch ${b.name}`}
                  className="space-y-2"
                >
                  <p>
                    Delete this branch and disconnect its editors? Commits
                    remain in history. Close any open pull requests first.
                  </p>
                  <DiscussionRemovalWarning
                    where="this branch"
                    counts={deleting.counts}
                  />
                  {!sameCounts(deleting.counts, b.discussionsOnDelete) && (
                    <CountsChanged />
                  )}
                  <Button
                    size="sm"
                    disabled={
                      action.pending ||
                      !sameCounts(deleting.counts, b.discussionsOnDelete)
                    }
                    onClick={() => {
                      void action.run(
                        {
                          type: "deletePageBranch",
                          branchId: b.id,
                          ...(deleting.counts
                            ? {
                                discussionsToRemove: discussionTotal(
                                  deleting.counts,
                                ),
                              }
                            : {}),
                        },
                        () => {
                          setDeleting(undefined);
                          if (branch?.id === b.id) setBranch(null);
                        },
                      );
                    }}
                  >
                    Confirm delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDeleting(undefined);
                      setReturnTo(b.id);
                    }}
                  >
                    Cancel
                  </Button>
                </Confirmation>
              )}
            </section>
          );
        })}
      </div>
      {canEdit && (
        <form
          aria-labelledby="new-branch-heading"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (problem) return;
            const id = crypto.randomUUID();
            void action.run(
              {
                type: "createPageBranch",
                pageId,
                branchId: id,
                name: name.trim(),
                ...(from ? { fromCommitId: from } : {}),
              },
              () => {
                setName("");
                setBranch(id);
              },
            );
          }}
        >
          <h3 id="new-branch-heading" className="text-sm font-medium">
            Start a branch
          </h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="block text-[13px] text-muted-foreground">
              Branch name
              <Input
                // One height (40px), one shape and one text size for the
                // field, the select and the button, so the labels share a
                // baseline and the row a bottom edge.
                className={`${field} mt-1 rounded-xl text-[13px]`}
                maxLength={80}
                placeholder="e.g. retry-window"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-describedby={name && problem ? problemId : undefined}
              />
            </label>
            <label className="block text-[13px] text-muted-foreground">
              Start from
              <DropdownSelect
                variant="field"
                size="lg"
                className="mt-1 w-full"
                value={from}
                onValueChange={(value) => setFrom(value)}
              >
                <DropdownSelectOption value="">
                  Current main version
                </DropdownSelectOption>
                {commits.map((c) => (
                  <DropdownSelectOption key={c.id} value={c.id}>
                    {c.message ?? c.title} · {c.id.slice(0, 8)}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            </label>
            <Button
              type="submit"
              size="lg"
              disabled={!name.trim() || Boolean(problem) || action.pending}
            >
              Create branch
            </Button>
          </div>
          {name && problem && (
            <p id={problemId} className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </form>
      )}
      {sync && (
        <ConflictResolution
          branchId={sync}
          onClose={() => setSync(undefined)}
        />
      )}
    </section>
  );
}
