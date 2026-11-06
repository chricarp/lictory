import { useState } from "react";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
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
  const { branches, commits, pullRequests } = usePageHistory(pageId);
  const { userId, memberName } = useWorkspace();
  const { canEdit } = usePageActions();
  const { branch, setBranch } = usePageBranchSelection();
  const [name, setName] = useState("");
  const [from, setFrom] = useState(branch?.headCommitId ?? "");
  const [sync, setSync] = useState<string>();
  // The branch being deleted and the counts its confirmation shows.
  const [deleting, setDeleting] = useState<{
    id: string;
    counts: DiscussionCounts | undefined;
  }>();
  // After a cancelled deletion, focus returns to that branch's button.
  const [returnTo, setReturnTo] = useState<string>();
  const action = useHistoryAction();
  const problem =
    branchNameProblem(name) ??
    (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())
      ? "That branch name is already in use."
      : null);
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Branches</h2>
      <ActionError error={action.error} />
      {branches.map((b) => (
        <section key={b.id} className="space-y-2 rounded-xl border p-4 text-sm">
          <h3 className="font-medium">{b.name}</h3>
          <p className="text-muted-foreground">
            Created by {memberName(b.authorId)}
            {b.draft?.uncommittedChanges ? " · Uncommitted live changes" : ""}
          </p>
          {b.collaboratorIds.length > 0 && (
            <p>Collaborators: {b.collaboratorIds.map(memberName).join(", ")}</p>
          )}
          {pullRequests
            .filter((p) => p.sourceBranchId === b.id && p.status !== "merged")
            .map((p) => (
              <p key={p.id}>Open pull request: {p.title}</p>
            ))}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setBranch(b.isMain ? null : b.id)}
            >
              Select {b.name}
            </Button>
            {canEdit &&
              !b.isMain &&
              (b.authorId === userId || b.collaboratorIds.includes(userId)) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSync(b.id)}
                >
                  Sync from main
                </Button>
              )}
            {canEdit && !b.isMain && deleting?.id !== b.id && (
              <Button
                size="sm"
                variant="ghost"
                autoFocus={returnTo === b.id}
                onClick={() => {
                  setReturnTo(undefined);
                  setDeleting({ id: b.id, counts: b.discussionsOnDelete });
                }}
              >
                Delete branch…
              </Button>
            )}
            {canEdit && !b.isMain && b.authorId === userId && (
              <ChoosePerson
                label="Add collaborator"
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
          </div>
          {deleting?.id === b.id && (
            <Confirmation
              label={`Delete branch ${b.name}`}
              className="space-y-2"
            >
              <p>
                Delete this branch and disconnect its editors? Commits remain in
                history. Close any open pull requests first.
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
      ))}
      {canEdit && (
        <form
          className="space-y-3 rounded-xl border p-4"
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
          <h3 className="font-medium">New branch</h3>
          <label className="block text-sm">
            Branch name
            <input
              className={`${field} mt-1`}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-describedby="branch-name-problem"
            />
          </label>
          {name && problem && (
            <p id="branch-name-problem" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <label className="block text-sm">
            Start from
            <select
              className={`${field} mt-1`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">Current main version</option>
              {commits.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.message ?? c.title} · {c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={Boolean(problem) || action.pending}>
            Create branch
          </Button>
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
