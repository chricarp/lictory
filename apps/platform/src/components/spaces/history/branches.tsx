import { useState } from "react";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { usePageBranchSelection } from "./branch-selection";
import { discussionTotal } from "@lictory/core/spaces/discussion-lifecycle";
import {
  ActionError,
  ChoosePerson,
  DiscussionRemovalWarning,
  field,
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
  const [deleting, setDeleting] = useState<string>();
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
            {canEdit && !b.isMain && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleting(b.id)}
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
          {deleting === b.id && (
            <div
              role="group"
              aria-label={`Delete branch ${b.name}`}
              className="space-y-2"
            >
              <p>
                Delete this branch and disconnect its editors? Commits remain in
                history. Close any open pull requests first.
              </p>
              <DiscussionRemovalWarning
                where="this branch"
                counts={b.discussionsOnDelete}
              />
              <Button
                size="sm"
                disabled={action.pending}
                onClick={() => {
                  void action.run(
                    {
                      type: "deletePageBranch",
                      branchId: b.id,
                      ...(b.discussionsOnDelete
                        ? {
                            discussionsToRemove: discussionTotal(
                              b.discussionsOnDelete,
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
                onClick={() => setDeleting(undefined)}
              >
                Cancel
              </Button>
            </div>
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
