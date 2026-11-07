import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@lictory/ui/select";
import { useState } from "react";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { DocumentDiff, RenderedDocumentDiff } from "./document-diff";
import { PageReader } from "@lictory/platform/components/spaces/editor/document";
import { Avatar } from "@lictory/ui/avatar";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { usePageActions } from "@lictory/platform/components/spaces/page-actions";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { Dialog } from "@lictory/platform/components/spaces/dialog";
import type { PageBranch } from "@lictory/platform/data/spaces";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { useSearchParams } from "@lictory/platform/lib/navigation";
import { ActionError, useHistoryAction } from "./shared";
import { commitReview } from "./approval";

export function Versions({
  pageId,
  branch,
}: {
  pageId: string;
  branch?: PageBranch;
}) {
  const { commits: allCommits, head, loaded } = usePageHistory(pageId);
  const lineHead =
    allCommits.find((c) => c.id === branch?.headCommitId) ?? head;
  // The first-parent line is this branch’s history. Merged proposal commits
  // remain on their own branch rather than appearing as duplicate versions.
  const byId = new Map(allCommits.map((c) => [c.id, c]));
  const lineage = new Set<string>();
  let cursor = lineHead;
  while (cursor && !lineage.has(cursor.id)) {
    lineage.add(cursor.id);
    cursor = byId.get(cursor.parentIds[0] ?? "");
  }
  const commits = allCommits.filter((c) => lineage.has(c.id));
  const { memberName, userId } = useWorkspace();
  const { canEdit } = usePageActions();
  const { publishing } = useSpace();
  const reviewOf = (approverIds: readonly string[]) =>
    commitReview(publishing, approverIds.map(memberName));
  const action = useHistoryAction();
  // `?version=…&compare=…` opens a comparison (a work item's pinned page
  // version against the published one).
  const search = useSearchParams();
  const [selected, setSelected] = useState(() => search.get("version") ?? "");
  const [compare, setCompare] = useState(() => search.get("compare") ?? "");
  const [restore, setRestore] = useState<string>();
  const [discard, setDiscard] = useState(false);
  const commit = commits.find((c) => c.id === selected) ?? lineHead;
  // A merge’s previous published version is its first parent, not the
  // chronologically adjacent source-branch commit (often identical content).
  const previous = commits.find((c) => c.id === commit?.parentIds[0]);
  const before = commits.find((c) => c.id === compare) ?? previous;
  const version = (id: string) =>
    `v${commits.findIndex((c) => c.id === id) + 1}`;
  const [showDocument, setShowDocument] = useState(false);
  const editable =
    canEdit &&
    branch?.draft &&
    (branch.isMain ||
      branch.authorId === userId ||
      branch.collaboratorIds.includes(userId));
  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <section aria-label="Versions">
        <h2 className="mb-3 font-semibold">Version history</h2>
        {!loaded && <p role="status">Loading history…</p>}
        <ol className="space-y-1">
          {[...commits].reverse().map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={c.id === commit?.id}
                className={`w-full rounded-xl border p-3 text-left text-sm transition-[background-color,border-color] duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${c.id === commit?.id ? "border-border bg-muted" : "border-transparent"}`}
                onClick={() => {
                  setSelected(c.id);
                  setCompare("");
                }}
              >
                <span className="mb-2 flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 font-mono text-xs font-semibold">
                    {version(c.id)}
                  </span>
                  <span className="line-clamp-2 font-medium">
                    {(c.message ?? c.title).replace(
                      /^Merge pull request: /,
                      "",
                    )}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Avatar
                    name={memberName(c.authorId)}
                    userId={c.authorId}
                    size="sm"
                  />
                  {memberName(c.authorId)}
                  <span aria-hidden="true">·</span>
                  <time
                    dateTime={c.createdAt}
                    title={new Date(c.createdAt).toLocaleString()}
                  >
                    {relativeTime(c.createdAt)}
                  </time>
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
          <div className="space-y-4 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight break-words">
                <span className="font-mono text-sm">{version(commit.id)}</span>{" "}
                ·{" "}
                {(commit.message ?? commit.title).replace(
                  /^Merge pull request: /,
                  "",
                )}
              </h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {memberName(commit.authorId)} ·{" "}
                <time
                  dateTime={commit.createdAt}
                  title={new Date(commit.createdAt).toLocaleString()}
                >
                  {relativeTime(commit.createdAt)}
                </time>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!showDocument && previous && (
                <Select value={before?.id ?? ""} onValueChange={setCompare}>
                  <SelectTrigger
                    variant="secondary"
                    aria-label="Compare with"
                    className="w-auto gap-2 text-sm"
                  >
                    Compare with {before && version(before.id)}
                  </SelectTrigger>
                  <SelectContent>
                    {commits
                      .filter((c) => c.id !== commit.id)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {version(c.id)} ·{" "}
                          {(c.message ?? c.title).replace(
                            /^Merge pull request: /,
                            "",
                          )}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              {editable && commit.id !== lineHead?.id && (
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
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={showDocument}
                onClick={() => setShowDocument(!showDocument)}
              >
                {showDocument ? "View changes" : "Preview this version"}
              </Button>
            </div>
          </div>
          {commit.approverIds.length > 0 && (
            <p className="text-sm">{reviewOf(commit.approverIds)?.line}</p>
          )}
          {(showDocument || !before) && (
            <PageReader
              content={commit.content}
              label={`${version(commit.id)} document`}
            />
          )}
          {before && !showDocument && (
            <div className="space-y-4">
              <DocumentDiff before={before.title} after={commit.title} />
              <RenderedDocumentDiff
                before={before.content}
                after={commit.content}
                beforeLabel={version(before.id)}
                afterLabel={version(commit.id)}
              />
            </div>
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
