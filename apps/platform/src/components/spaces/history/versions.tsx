import { useMemo, useState } from "react";
import { diffDocuments } from "@lictory/core/spaces/document/diff";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { DocumentDiff } from "./document-diff";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { Dialog } from "@lictory/platform/components/spaces/dialog";
import type { PageBranch } from "@lictory/platform/data/spaces";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { ActionError, field, useHistoryAction } from "./shared";
import { commitReview } from "./approval";

export function Versions({
  pageId,
  branch,
}: {
  pageId: string;
  branch?: PageBranch;
}) {
  const { commits, head, loaded } = usePageHistory(pageId);
  const { memberName, userId } = useWorkspace();
  const { canEdit } = usePageActions();
  const { publishing } = useSpace();
  const reviewOf = (approverIds: readonly string[]) =>
    commitReview(publishing, approverIds.map(memberName));
  const action = useHistoryAction();
  const [selected, setSelected] = useState("");
  const [compare, setCompare] = useState("");
  const [restore, setRestore] = useState<string>();
  const [discard, setDiscard] = useState(false);
  const commit = commits.find((c) => c.id === selected) ?? head;
  const before = commits.find(
    (c) => c.id === (compare || commit?.parentIds[0]),
  );
  const changes = useMemo(
    () =>
      before && commit
        ? diffDocuments(before.content, commit.content).filter(
            (c) => c.kind !== "unchanged",
          )
        : [],
    [before, commit],
  );
  const editable =
    canEdit &&
    branch?.draft &&
    (branch.isMain ||
      branch.authorId === userId ||
      branch.collaboratorIds.includes(userId));
  return (
    <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
      <section aria-label="Versions">
        <h2 className="mb-3 font-semibold">Version history</h2>
        {!loaded && <p role="status">Loading history…</p>}
        <ol className="space-y-2">
          {[...commits].reverse().map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={c.id === commit?.id}
                className={`w-full rounded-xl border p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${c.id === commit?.id ? "bg-muted" : ""}`}
                onClick={() => {
                  setSelected(c.id);
                  setCompare("");
                }}
              >
                <span className="block font-medium break-words">
                  {c.message ?? c.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {memberName(c.authorId)} · {relativeTime(c.createdAt)}
                </span>
                {c.contributorIds.filter((id) => id !== c.authorId).length >
                  0 && (
                  <span className="block text-xs">
                    With{" "}
                    {c.contributorIds
                      .filter((id) => id !== c.authorId)
                      .map(memberName)
                      .join(", ")}
                  </span>
                )}
                {c.id === head?.id && (
                  <span className="mt-1 inline-block rounded-full border px-2 text-xs">
                    Published
                  </span>
                )}
                {c.approverIds.length > 0 && (
                  <span className="ml-1 inline-block rounded-full border px-2 text-xs">
                    {reviewOf(c.approverIds)?.badge}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </section>
      {commit && (
        <section aria-label="Selected version" className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold break-words">{commit.title}</h2>
          {commit.approverIds.length > 0 && (
            <p className="text-sm">{reviewOf(commit.approverIds)?.line}</p>
          )}
          <Markdown source={commit.markdown} />
          <label className="block text-sm">
            Compare with
            <select
              className={`${field} mt-1`}
              value={(compare || commit.parentIds[0]) ?? ""}
              onChange={(e) => setCompare(e.target.value)}
            >
              <option value="">Choose a version</option>
              {commits
                .filter((c) => c.id !== commit.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.message ?? c.title} · {relativeTime(c.createdAt)}
                  </option>
                ))}
            </select>
          </label>
          {before && (
            <div className="space-y-3">
              <h3 className="font-medium">Changes from selected comparison</h3>
              {before.title !== commit.title && (
                <DocumentDiff before={before.title} after={commit.title} />
              )}
              {changes.map((c) => (
                <section key={c.blockId} className="space-y-1">
                  <h4 className="text-xs font-medium capitalize">
                    {c.kind} block
                  </h4>
                  <DocumentDiff
                    before={c.beforeMarkdown ?? ""}
                    after={c.afterMarkdown ?? ""}
                  />
                </section>
              ))}
              {!changes.length && before.title === commit.title && (
                <p className="text-sm text-muted-foreground">No changes.</p>
              )}
            </div>
          )}
          {editable && (
            <Button
              variant="secondary"
              onClick={() => {
                setDiscard(false);
                setRestore(branch?.headCommitId);
              }}
            >
              Restore this version
            </Button>
          )}
          {restore && branch && (
            <Dialog
              title="Restore this version?"
              description="Creates a new commit with this version’s content. The live draft restarts and connected editors reconnect; historical versions stay unchanged."
              onClose={() => setRestore(undefined)}
              onSubmit={() => {
                void action.run(
                  {
                    type: "restorePageCommit",
                    pageId,
                    branchId: branch.id,
                    commitId: commit.id,
                    expectedHead: restore,
                    discardDraftChanges: discard,
                  },
                  () => setRestore(undefined),
                );
              }}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setRestore(undefined)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      action.pending ||
                      Boolean(branch.draft?.uncommittedChanges && !discard)
                    }
                  >
                    Restore version
                  </Button>
                </>
              }
            >
              <p className="text-sm">Restore to {branch.name}.</p>
              {branch.draft?.uncommittedChanges && (
                <label className="mt-3 flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={discard}
                    onChange={(e) => setDiscard(e.target.checked)}
                  />
                  Discard live changes on this branch
                </label>
              )}
              <ActionError error={action.error} />
            </Dialog>
          )}
        </section>
      )}
    </div>
  );
}
