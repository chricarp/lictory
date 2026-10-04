"use client";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import { useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitMerge,
  ArrowLeft,
  Trash2,
  Plus,
  LockKeyhole,
} from "lucide-react";
import { byType, relativeTime } from "~/lib/work-items";
import {
  BRANCH_NAME_MAX_LENGTH,
  branchNameProblem,
  finalizeBranchName,
  sanitizeBranchNameInput,
} from "~/lib/branch-name";
import type { Command, EntityOf } from "~/sync/shared/protocol";
import {
  mergeBase,
  mergeSnapshot,
  type Snapshot,
  type MergeChunk,
} from "~/sync/shared/merge";
import { Button } from "~/components/ui/button";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import { MarkdownEditor } from "~/components/ui/markdown-editor";
import { Markdown } from "~/components/items/markdown";
import { RevisionDiff } from "~/components/items/diff";
import { useItem } from "~/components/items/item-context";
import { useWorkspace } from "~/components/workspace/provider";
import { Thread, ThreadComposer } from "./threads";
import { LictoryActionCheck, useActionGate } from "./ai-review";

type Branch = EntityOf<"specBranch">;
type Commit = EntityOf<"specCommit">;
export type BranchScreen =
  | { kind: "branches" }
  | { kind: "branch"; id: string }
  | { kind: "pr"; id: string };
const field =
  "w-full rounded-md border border-input bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
function useBranchData() {
  const ctx = useItem();
  return {
    ...ctx,
    branches: byType(ctx.entities, "specBranch"),
    commits: byType(ctx.entities, "specCommit"),
    prs: byType(ctx.entities, "pullRequest"),
    prReviews: byType(ctx.entities, "prReview"),
  };
}
function useAction() {
  const { mutateConfirmed: mutate } = useItem();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const run = async (c: Command, done?: () => void) => {
    setPending(true);
    setError("");
    try {
      await mutate(c);
      done?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error };
}
function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  ) : null;
}
export function BranchEntry({ onOpen }: { onOpen: () => void }) {
  const { branches, prs, item } = useBranchData();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 border-b pb-3 text-[13px]">
      <GitBranch className="size-4 text-muted-foreground" />
      <span className="font-medium">main</span>
      {item.mainProtected && (
        <Badge>
          <LockKeyhole className="size-3" />
          Protected
        </Badge>
      )}
      <span className="text-muted-foreground">
        Revision {item.revisionNumber}
      </span>
      <Button className="ml-auto" variant="secondary" onClick={onOpen}>
        <GitPullRequest className="size-3.5" />
        Branches & pull requests
        {prs.filter((p) => p.status === "open").length
          ? ` (${prs.filter((p) => p.status === "open").length})`
          : ""}
      </Button>
      {branches.length > 1 && (
        <span className="text-xs text-muted-foreground">
          {branches.length - 1} branches
        </span>
      )}
    </div>
  );
}
export function BranchWorkspace({
  screen,
  onNavigate,
  onMain,
}: {
  screen: BranchScreen;
  onNavigate: (screen: BranchScreen) => void;
  onMain: () => void;
}) {
  const data = useBranchData();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button variant="ghost" onClick={onMain}>
          <ArrowLeft className="size-3.5" />
          Main · revision {data.item.revisionNumber}
        </Button>
        <Button
          variant={screen.kind === "branches" ? "secondary" : "ghost"}
          onClick={() => onNavigate({ kind: "branches" })}
        >
          <GitBranch className="size-3.5" />
          Branches & pull requests
        </Button>
        <DropdownSelect
          aria-label="Switch branch"
          variant="secondary"
          className="max-w-48 min-w-32"
          value={screen.kind === "branch" ? screen.id : ""}
          onValueChange={(value) =>
            value ? onNavigate({ kind: "branch", id: value }) : onMain()
          }
        >
          <DropdownSelectOption value="">main</DropdownSelectOption>
          {data.branches
            .filter((b) => b.name !== "main")
            .map((b) => (
              <DropdownSelectOption key={b.id} value={b.id}>
                {b.name}
              </DropdownSelectOption>
            ))}
        </DropdownSelect>
        <span className="ml-auto truncate text-sm text-muted-foreground">
          {data.project.key}-{data.item.number}
        </span>
      </div>
      {screen.kind === "branches" ? (
        <BranchOverview onNavigate={onNavigate} />
      ) : screen.kind === "branch" ? (
        <BranchEditor
          key={screen.id}
          branchId={screen.id}
          onNavigate={onNavigate}
        />
      ) : (
        <PullRequestView
          key={screen.id}
          id={screen.id}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
function BranchOverview({
  onNavigate,
}: {
  onNavigate: (screen: BranchScreen) => void;
}) {
  const { branches, prs, item, base, readOnly, memberName } = useBranchData();
  const { run, error, pending } = useAction();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const finalName = finalizeBranchName(name);
  // Only show problems that typing can't fix; trailing separators are trimmed on submit.
  const nameProblem = name
    ? (branchNameProblem(finalName) ??
      (branches.some((b) => b.name === finalName)
        ? "That branch name is already in use."
        : null))
    : null;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Branches & pull requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Collaborate on changes, commit them to a branch, and review the result
          before merging.
        </p>
      </div>
      <ErrorMessage message={error} />
      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setName(finalName);
            if (nameProblem) return;
            const id = crypto.randomUUID();
            void run(
              {
                type: "createBranch",
                ...base,
                branchId: id,
                name: finalName,
                fromBranchId: from || undefined,
              },
              () => onNavigate({ kind: "branch", id }),
            );
          }}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
            New branch name
            <input
              aria-label="New branch name"
              className={`${field} h-8`}
              value={name}
              onChange={(e) => setName(sanitizeBranchNameInput(e.target.value))}
              onBlur={() => setName((n) => finalizeBranchName(n))}
              placeholder="e.g. clarify-timeout"
              required
              aria-invalid={nameProblem ? true : undefined}
              aria-describedby={
                nameProblem ? "new-branch-name-problem" : undefined
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={BRANCH_NAME_MAX_LENGTH}
            />
            {nameProblem && (
              <span
                id="new-branch-name-problem"
                className="font-normal text-destructive"
              >
                {nameProblem}
              </span>
            )}
          </label>
          <label className="flex w-40 min-w-0 flex-col gap-1 text-xs font-medium">
            Branch from
            <DropdownSelect
              aria-label="Branch from"
              className="w-full"
              value={from}
              onValueChange={(value) => setFrom(value)}
            >
              <DropdownSelectOption value="">main</DropdownSelectOption>
              {branches
                .filter((b) => b.name !== "main")
                .map((b) => (
                  <DropdownSelectOption key={b.id} value={b.id}>
                    {b.name}
                  </DropdownSelectOption>
                ))}
            </DropdownSelect>
          </label>
          <Button type="submit" disabled={pending || !name || !!nameProblem}>
            <Plus className="size-3.5" />
            Create branch
          </Button>
        </form>
      )}
      <section>
        <SectionLabel>Branches</SectionLabel>
        <div className="mt-2 divide-y rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 text-sm">
            <GitBranch className="size-4" />
            <b>main</b>
            <Badge>Default</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              Revision {item.revisionNumber}
            </span>
          </div>
          {branches
            .filter((b) => b.name !== "main")
            .map((b) => (
              <button
                key={b.id}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onNavigate({ kind: "branch", id: b.id })}
              >
                <GitBranch className="size-4 text-muted-foreground" />
                <b className="truncate">{b.name}</b>
                <span className="ml-auto text-xs text-muted-foreground">
                  {memberName(b.authorId)} · {b.collaboratorIds.length}{" "}
                  collaborators
                </span>
              </button>
            ))}
          {branches.length <= 1 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Create a branch to propose your first change.
            </p>
          )}
        </div>
      </section>
      <section>
        <SectionLabel>Pull requests</SectionLabel>
        <div className="mt-2 divide-y rounded-lg border">
          {prs.length ? (
            prs
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onNavigate({ kind: "pr", id: p.id })}
                >
                  <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {p.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {branches.find((b) => b.id === p.sourceId)?.name ??
                        "Deleted branch"}{" "}
                      →{" "}
                      {branches.find((b) => b.id === p.targetId)?.name ??
                        "Deleted branch"}{" "}
                      · {memberName(p.authorId)} · {relativeTime(p.createdAt)}
                    </span>
                  </span>
                  <Badge tone={p.status === "merged" ? "good" : undefined}>
                    {p.status}
                  </Badge>
                </button>
              ))
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No pull requests yet. Commit changes on a branch, then open one
              for review.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

type Draft = Snapshot & { baseCommitId: string; message: string };
function BranchEditor({
  branchId,
  onNavigate,
}: {
  branchId: string;
  onNavigate: (screen: BranchScreen) => void;
}) {
  const {
    branches,
    commits,
    item,
    userId,
    readOnly,
    memberName,
    capabilities,
  } = useBranchData();
  const branch = branches.find((b) => b.id === branchId);
  const head = commits.find((c) => c.id === branch?.headId);
  if (!branch || !head) return <p>This branch is unavailable.</p>;
  return (
    <BranchEditorBody
      branch={branch}
      head={head}
      commits={commits}
      itemId={item.id}
      organizationId={item.organizationId}
      userId={userId}
      canEdit={
        !readOnly &&
        (branch.authorId === userId || branch.collaboratorIds.includes(userId))
      }
      canDelete={
        !readOnly &&
        (branch.authorId === userId || capabilities.editSpecifications)
      }
      memberName={memberName}
      onNavigate={onNavigate}
    />
  );
}
function BranchEditorBody({
  branch,
  head,
  commits,
  itemId,
  organizationId,
  userId,
  canEdit,
  canDelete,
  memberName,
  onNavigate,
}: {
  branch: Branch;
  head: Commit;
  commits: Commit[];
  itemId: string;
  organizationId: string;
  userId: string;
  canEdit: boolean;
  canDelete: boolean;
  memberName: (id: string) => string;
  onNavigate: (screen: BranchScreen) => void;
}) {
  const { directory } = useWorkspace();
  const { branches } = useBranchData();
  const { run, error, pending } = useAction();
  const key = `lictory:branch-draft:${userId}:${organizationId}:${itemId}:${branch.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window !== "undefined")
      try {
        const raw = JSON.parse(
          localStorage.getItem(key) ?? "null",
        ) as Draft | null;
        if (
          raw &&
          typeof raw.title === "string" &&
          typeof raw.content === "string" &&
          typeof raw.baseCommitId === "string" &&
          typeof raw.message === "string"
        )
          return raw;
      } catch {}
    return {
      title: head.title,
      content: head.content,
      baseCommitId: head.id,
      message: "",
    };
  });
  const [resolving, setResolving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState("document");
  useEffect(() => {
    if (canEdit) localStorage.setItem(key, JSON.stringify(draft));
  }, [draft, key, canEdit]);
  const start = commits.find((c) => c.id === draft.baseCommitId) ?? head;
  const result = useMemo(
    () => mergeSnapshot(start, draft, head),
    [start, draft, head],
  );
  const changed =
    draft.title !== start.title || draft.content !== start.content;
  const reset = () => {
    setDraft({
      title: head.title,
      content: head.content,
      baseCommitId: head.id,
      message: "",
    });
    setResolving(false);
  };
  const commit = (snapshot: Snapshot, resolve = false) =>
    void run(
      {
        type: "commitBranch",
        workItemId: itemId,
        branchId: branch.id,
        baseCommitId: draft.baseCommitId,
        ...snapshot,
        message: draft.message || "Update specification",
        ...(resolve ? { expectedHeadId: head.id } : {}),
      },
      () => {
        // The synchronized head is refreshed by mutate before it resolves. Start
        // the next draft from that committed snapshot on the next render.
        localStorage.removeItem(key);
        setDraft({
          ...(!resolve
            ? { title: result.title, content: result.content }
            : snapshot),
          baseCommitId: head.id,
          message: "",
        });
        setResolving(false);
        setTab("document");
      },
    );
  // A successful commit's snapshot can automatically advance its editor base
  // without replacing an in-progress draft when someone else commits.
  useEffect(() => {
    if (
      head.id !== draft.baseCommitId &&
      (!changed ||
        (head.title === draft.title && head.content === draft.content))
    ) {
      // Reconcile a confirmed commit (or an idle editor) with the durable head.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({
        ...d,
        title: head.title,
        content: head.content,
        baseCommitId: head.id,
      }));
    }
  }, [head, changed, draft.title, draft.content, draft.baseCommitId]);
  const history = ancestry(commits, head.id);
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <GitBranch className="size-5" />
            {branch.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes stay on this branch until a reviewed pull request is merged.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!canEdit || pending}
          onClick={() => setOpening((v) => !v)}
        >
          <GitPullRequest className="size-3.5" />
          Open pull request
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            aria-label="Delete branch"
            onClick={() => setDeleting(true)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <ErrorMessage message={error} />
      {deleting && (
        <DeletePrompt
          name={`branch ${branch.name}`}
          pending={pending}
          onCancel={() => setDeleting(false)}
          onDelete={() =>
            void run(
              { type: "deleteBranch", workItemId: itemId, branchId: branch.id },
              () => onNavigate({ kind: "branches" }),
            )
          }
        />
      )}
      {opening && (
        <CreatePR
          source={branch}
          onCreated={(id) => onNavigate({ kind: "pr", id })}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <nav className="flex gap-2 border-b pb-2" aria-label="Branch views">
            {["document", "changes", "commits"].map((t) => (
              <Button
                key={t}
                variant={tab === t ? "secondary" : "ghost"}
                onClick={() => setTab(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </nav>
          {head.id !== start.id && changed && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p>
                {result.conflicted
                  ? "Another commit overlaps your edits. Resolve the conflicts before committing."
                  : "This branch advanced while you were editing. Independent changes will be merged into your commit."}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setResolving(true)}>
                  Compare & resolve
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Discard my changes
                </Button>
              </div>
            </div>
          )}
          {resolving ? (
            <ConflictResolver
              base={start}
              ours={draft}
              theirs={head}
              onCancel={() => setResolving(false)}
              onResolve={(s) => commit(s, true)}
              pending={pending}
              action="Commit resolution"
            />
          ) : tab === "commits" ? (
            <CommitHistory commits={history} memberName={memberName} />
          ) : tab === "changes" ? (
            <>
              <h2 className="text-sm font-medium">Your uncommitted changes</h2>
              {start.title !== draft.title && (
                <p className="text-sm">
                  Title: {start.title} → {draft.title}
                </p>
              )}
              <RevisionDiff before={start.content} after={draft.content} />
            </>
          ) : canEdit ? (
            <>
              <label className="block space-y-1 text-xs font-medium">
                Work item title
                <input
                  aria-label="Branch work item title"
                  className={`${field} text-xl font-semibold`}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                  maxLength={240}
                />
              </label>
              <MarkdownEditor
                aria-label="Branch specification"
                fileContext={{ organizationId, workItemId: itemId }}
                value={draft.content}
                onValueChange={(content) =>
                  setDraft((d) => ({ ...d, content }))
                }
                className="min-h-[400px] px-4 pt-4 font-mono"
                previewClassName="min-h-[400px] px-4 pt-4"
              />
              <p className="text-xs text-muted-foreground">
                Acceptance criteria are part of the specification. Your
                uncommitted draft is saved in this browser.
              </p>
              <label className="block space-y-1 text-xs font-medium">
                Commit message
                <input
                  aria-label="Commit message"
                  className={`${field} h-8`}
                  value={draft.message}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, message: e.target.value }))
                  }
                  placeholder="Explain what changed"
                  maxLength={500}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={reset}>
                  Discard changes
                </Button>
                <Button
                  disabled={
                    pending ||
                    !changed ||
                    !draft.title.trim() ||
                    !draft.message.trim()
                  }
                  onClick={() =>
                    result.conflicted ? setResolving(true) : commit(draft)
                  }
                >
                  <GitCommitHorizontal className="size-3.5" />
                  {result.conflicted ? "Resolve & commit" : "Commit changes"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">{head.title}</h2>
              <Markdown source={head.content} />
              <p className="text-sm text-muted-foreground">
                Ask the branch author to invite you as a collaborator to commit
                changes.
              </p>
            </>
          )}
        </div>
        <aside className="space-y-5 rounded-lg border bg-muted/20 p-4">
          <section>
            <SectionLabel>Latest commit</SectionLabel>
            <p className="mt-2 text-sm font-medium">{head.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {memberName(head.authorId)} · {relativeTime(head.createdAt)}
            </p>
            <code className="text-xs text-muted-foreground">
              {head.id.slice(0, 8)}
            </code>
          </section>
          <section>
            <SectionLabel>Collaborators</SectionLabel>
            <ul className="mt-2 space-y-2">
              {branch.collaboratorIds.map((id) => (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {memberName(id)}
                  </span>
                  {id === branch.authorId ? (
                    <Badge>Author</Badge>
                  ) : (
                    branch.authorId === userId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Remove ${memberName(id)}`}
                        onClick={() =>
                          void run({
                            type: "setBranchCollaborator",
                            workItemId: itemId,
                            branchId: branch.id,
                            userId: id,
                            assigned: false,
                          })
                        }
                      >
                        Remove
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
            {branch.authorId === userId && (
              <label className="mt-3 block space-y-1 text-xs font-medium">
                Invite collaborator
                <DropdownSelect
                  placeholder="Choose a person…"
                  aria-label="Invite collaborator"
                  className="w-full"
                  value=""
                  disabled={pending}
                  onValueChange={(value) =>
                    void run({
                      type: "setBranchCollaborator",
                      workItemId: itemId,
                      branchId: branch.id,
                      userId: value,
                      assigned: true,
                    })
                  }
                >
                  {directory.members
                    .filter((m) => !branch.collaboratorIds.includes(m.id))
                    .map((m) => (
                      <DropdownSelectOption key={m.id} value={m.id}>
                        {m.name}
                      </DropdownSelectOption>
                    ))}
                </DropdownSelect>
              </label>
            )}
          </section>
          <section>
            <SectionLabel>Update from another branch</SectionLabel>
            <SyncBranch
              source={branch}
              targets={branches.filter((b) => b.id !== branch.id)}
              disabled={!canEdit || pending}
            />
          </section>
        </aside>
      </div>
    </>
  );
}
function ancestry(commits: Commit[], head: string) {
  const map = new Map(commits.map((c) => [c.id, c])),
    seen = new Set<string>(),
    queue = [head];
  for (const id of queue) {
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(map.get(id)?.parentIds ?? []));
  }
  return commits
    .filter((c) => seen.has(c.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function CommitHistory({
  commits,
  memberName,
}: {
  commits: Commit[];
  memberName: (id: string) => string;
}) {
  return (
    <ol className="divide-y rounded-lg border">
      {commits.map((c) => (
        <li key={c.id} className="space-y-1 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <GitCommitHorizontal className="size-4 text-muted-foreground" />
            {c.message}
          </p>
          <p className="text-xs text-muted-foreground">
            {memberName(c.authorId)} · {relativeTime(c.createdAt)} ·{" "}
            <code>{c.id.slice(0, 8)}</code>
            {c.parentIds.length > 1 ? " · Merge commit" : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
function CreatePR({
  source,
  onCreated,
}: {
  source: Branch;
  onCreated: (id: string) => void;
}) {
  const { branches, item } = useBranchData();
  const { run, pending, error } = useAction();
  const [target, setTarget] = useState(
    branches.find((b) => b.name === "main")?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const submit = (draft: boolean) => {
    const id = crypto.randomUUID();
    void run(
      {
        type: "createPullRequest",
        workItemId: item.id,
        pullRequestId: id,
        sourceId: source.id,
        targetId: target,
        title,
        description,
        draft,
      },
      () => onCreated(id),
    );
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <h2 className="text-sm font-semibold">Open a pull request</h2>
      <ErrorMessage message={error} />
      <label className="block space-y-1 text-xs font-medium">
        Target branch
        <DropdownSelect
          aria-label="PR target branch"
          className="w-full"
          value={target}
          onValueChange={(value) => setTarget(value)}
        >
          {branches
            .filter((b) => b.id !== source.id)
            .map((b) => (
              <DropdownSelectOption key={b.id} value={b.id}>
                {b.name}
              </DropdownSelectOption>
            ))}
        </DropdownSelect>
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Title
        <input
          aria-label="Pull request title"
          className={`${field} h-8`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      </label>
      <label className="block space-y-1 text-xs font-medium">
        Description
        <textarea
          aria-label="Pull request description"
          className={`${field} py-2`}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={10000}
          placeholder="Why is this change needed?"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={pending || !title.trim() || !description.trim()}
          onClick={() => submit(true)}
        >
          Create draft PR
        </Button>
        <Button
          disabled={pending || !title.trim() || !description.trim()}
          onClick={() => submit(false)}
        >
          Create pull request
        </Button>
      </div>
    </div>
  );
}
function DeletePrompt({
  name,
  pending,
  onCancel,
  onDelete,
}: {
  name: string;
  pending: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 p-3 text-sm"
    >
      <p className="flex-1">
        Delete {name}? It will disappear from the workspace. Commits and
        activity remain in history.
      </p>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="danger" disabled={pending} onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

export function ConflictResolver({
  base,
  ours,
  theirs,
  onResolve,
  onCancel,
  pending,
  action,
}: {
  base: Snapshot;
  ours: Snapshot;
  theirs: Snapshot;
  onResolve: (snapshot: Snapshot) => void;
  onCancel: () => void;
  pending: boolean;
  action: string;
}) {
  const result = useMemo(
    () => mergeSnapshot(base, ours, theirs),
    [base, ours, theirs],
  );
  const [title, setTitle] = useState(result.title);
  const [choices, setChoices] = useState<Record<number, string[]>>({});
  const conflicts = result.chunks.flatMap((chunk, i) =>
    "lines" in chunk ? [] : [{ chunk, i }],
  );
  const complete =
    conflicts.every(({ i }) => choices[i] !== undefined) &&
    title.trim().length > 0;
  return (
    <section className="space-y-4 rounded-lg border border-amber-500/40 p-4">
      <h2 className="text-base font-semibold">Resolve changes</h2>
      <p className="text-sm text-muted-foreground">
        Compare the shared base, your changes, and the current branch.
        Independent edits are already combined.
      </p>
      {result.titleConflict ? (
        <div className="space-y-2">
          <p className="text-sm">Title conflict · base: {base.title}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setTitle(ours.title)}>
              Use my title
            </Button>
            <Button variant="secondary" onClick={() => setTitle(theirs.title)}>
              Use their title
            </Button>
          </div>
          <input
            aria-label="Resolved title"
            className={`${field} h-8`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-sm font-medium">Title: {title}</p>
      )}
      {conflicts.map(({ chunk, i }, n) => (
        <ConflictChunk
          key={i}
          chunk={chunk}
          number={n + 1}
          value={choices[i]}
          onChange={(value) => setChoices((c) => ({ ...c, [i]: value }))}
        />
      ))}
      {!conflicts.length && (
        <RevisionDiff before={ours.content} after={result.content} />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            onResolve({ title: theirs.title, content: theirs.content })
          }
        >
          Discard my changes
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            onResolve({ title: ours.title, content: ours.content })
          }
        >
          Keep all my changes
        </Button>
        <Button
          disabled={pending || !complete}
          onClick={() =>
            onResolve({
              title,
              content: result.chunks
                .flatMap((c, i) => ("lines" in c ? c.lines : choices[i]!))
                .join("\n"),
            })
          }
        >
          {action}
        </Button>
      </div>
    </section>
  );
}
function ConflictChunk({
  chunk,
  number,
  value,
  onChange,
}: {
  chunk: Exclude<MergeChunk, { lines: string[] }>;
  number: number;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">Conflict {number}</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {(
          [
            ["Base", chunk.base],
            ["Your changes", chunk.ours],
            ["Current changes", chunk.theirs],
          ] as const
        ).map(([label, lines]) => (
          <div key={label}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {label}
            </p>
            <pre className="overflow-auto rounded-md bg-muted/40 p-2 text-xs whitespace-pre-wrap">
              {lines.length ? lines.join("\n") : "(removed)"}
            </pre>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange(chunk.ours)}
        >
          Keep mine
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange(chunk.theirs)}
        >
          Keep theirs
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange([...chunk.ours, ...chunk.theirs])}
        >
          Keep both
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onChange(value ?? chunk.ours)}
        >
          Merge manually
        </Button>
      </div>
      {value !== undefined && (
        <textarea
          aria-label={`Resolved conflict ${number}`}
          className={`${field} font-mono`}
          rows={4}
          value={value.join("\n")}
          onChange={(e) =>
            onChange(e.target.value ? e.target.value.split("\n") : [])
          }
        />
      )}
    </div>
  );
}

function SyncBranch({
  source,
  targets,
  disabled,
}: {
  source: Branch;
  targets: Branch[];
  disabled: boolean;
}) {
  const { commits, item } = useBranchData();
  const { run, error, pending } = useAction();
  const [targetId, setTargetId] = useState(
    targets.find((b) => b.name === "main")?.id ?? targets[0]?.id ?? "",
  );
  const [resolving, setResolving] = useState(false);
  const target = targets.find((b) => b.id === targetId),
    ours = commits.find((c) => c.id === source.headId),
    theirs = commits.find((c) => c.id === target?.headId);
  const base = target
    ? mergeBase(commits, source.headId, target.headId)
    : undefined;
  const sync = (snapshot?: Snapshot) => {
    if (target)
      void run(
        {
          type: "syncBranch",
          workItemId: item.id,
          branchId: source.id,
          targetId: target.id,
          sourceHeadId: source.headId,
          targetHeadId: target.headId,
          ...snapshot,
        },
        () => setResolving(false),
      );
  };
  return (
    <div className="mt-2 space-y-2">
      <ErrorMessage message={error} />
      <DropdownSelect
        aria-label="Update branch from"
        className="w-full"
        value={targetId}
        disabled={disabled}
        onValueChange={(value) => setTargetId(value)}
      >
        {targets.map((b) => (
          <DropdownSelectOption key={b.id} value={b.id}>
            {b.name}
          </DropdownSelectOption>
        ))}
      </DropdownSelect>
      <Button
        size="sm"
        variant="secondary"
        disabled={
          disabled || pending || !target || target.headId === source.headId
        }
        onClick={() => setResolving(true)}
      >
        Compare & update branch
      </Button>
      {resolving && ours && theirs && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-4 md:p-12">
          <div className="mx-auto max-w-5xl">
            <ConflictResolver
              key={`${ours.id}:${theirs.id}`}
              base={base ?? { title: "", content: "" }}
              ours={ours}
              theirs={theirs}
              pending={pending}
              action="Commit branch update"
              onCancel={() => setResolving(false)}
              onResolve={sync}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function useMergeHash(snapshot: Snapshot | undefined) {
  const serialized = snapshot
    ? JSON.stringify([snapshot.title, snapshot.content])
    : "";
  const [value, setValue] = useState({ serialized: "", hash: "" });
  useEffect(() => {
    let active = true;
    if (serialized)
      void crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(serialized))
        .then((buffer) => {
          if (active)
            setValue({
              serialized,
              hash: Array.from(new Uint8Array(buffer), (b) =>
                b.toString(16).padStart(2, "0"),
              ).join(""),
            });
        });
    return () => {
      active = false;
    };
  }, [serialized]);
  return value.serialized === serialized ? value.hash : "";
}
function PullRequestView({
  id,
  onNavigate,
}: {
  id: string;
  onNavigate: (screen: BranchScreen) => void;
}) {
  const {
    prs,
    branches,
    commits,
    prReviews,
    entities,
    item,
    userId,
    capabilities,
    readOnly,
    memberName,
    activity,
  } = useBranchData();
  const { directory } = useWorkspace();
  const { run, error, pending } = useAction();
  const [tab, setTab] = useState("conversation");
  const [deleting, setDeleting] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [draft, setDraft] = useState<{
    quote?: string;
    section: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const p = prs.find((p) => p.id === id),
    source = branches.find((b) => b.id === p?.sourceId),
    target = branches.find((b) => b.id === p?.targetId),
    ours = commits.find((c) => c.id === source?.headId),
    theirs = commits.find((c) => c.id === target?.headId);
  const common =
    ours && theirs ? mergeBase(commits, ours.id, theirs.id) : undefined;
  const result =
    common && ours && theirs ? mergeSnapshot(common, ours, theirs) : undefined;
  const merged = commits.find((c) => c.id === p?.mergedCommitId);
  const hash = useMergeHash(
    p?.status === "merged"
      ? merged
      : result && !result.conflicted
        ? result
        : undefined,
  );
  const actionGate = useActionGate(id, source?.headId);
  if (!p) return <p>This pull request is unavailable.</p>;
  const mergeActivity = activity.find(
    (a) =>
      a.action === "pull_request_merged" && a.detail?.pullRequestId === p.id,
  );
  const sourceName =
    source?.name ??
    (typeof mergeActivity?.detail?.source === "string"
      ? mergeActivity.detail.source
      : "Deleted branch");
  const automaticallyDeleted = activity.some(
    (a) =>
      a.action === "branch_deleted" &&
      a.detail?.automatic === true &&
      a.detail?.pullRequestId === p.id,
  );
  const reviews = prReviews.filter((r) => r.pullRequestId === p.id);
  const threads = byType(entities, "thread").filter(
    (t) => t.pullRequestId === p.id,
  );
  const manage =
    !readOnly &&
    (p.authorId === userId || source?.collaboratorIds.includes(userId));
  const required = reviews.filter((r) => r.required);
  const valid = (r: EntityOf<"prReview">) =>
    r.decision === "approved" &&
    r.resultHash === hash &&
    Boolean(hash) &&
    directory.roles.some(
      (role) =>
        role.id === r.roleId &&
        !role.archivedAt &&
        role.capabilities.review &&
        role.userIds.includes(r.reviewerId ?? ""),
    );
  const blockers = [
    ...(p.status === "draft" ? ["This pull request is a draft."] : []),
    ...(!result || result.conflicted
      ? ["The branches have merge conflicts."]
      : []),
    ...(result &&
    !result.conflicted &&
    result.title === theirs?.title &&
    result.content === theirs?.content
      ? ["This branch has no changes to merge."]
      : []),
    ...(!required.length ? ["Request at least one required review."] : []),
    ...required
      .filter((r) => !valid(r))
      .map(
        (r) =>
          `${directory.roles.find((role) => role.id === r.roleId)?.name ?? "Reviewer"} approval is pending or stale.`,
      ),
    ...(reviews.some(
      (r) => r.decision === "changes_requested" && r.resultHash === hash,
    )
      ? ["A reviewer requested changes."]
      : []),
    ...(threads.some((t) => t.blocking && t.status === "open")
      ? ["Blocking discussions remain open."]
      : []),
    ...(actionGate ? [actionGate] : []),
  ];
  const mergedBase = merged?.parentIds[0]
    ? commits.find((c) => c.id === merged.parentIds[0])
    : undefined;
  const display = p.status === "merged" ? merged : result;
  const before = p.status === "merged" ? mergedBase : theirs;
  const canMerge =
    !readOnly &&
    source &&
    target &&
    (target.name === "main"
      ? capabilities.editSpecifications
      : target.collaboratorIds.includes(userId));
  const sourceHistory = ours
    ? ancestry(commits, ours.id).filter(
        (c) =>
          !theirs || !ancestry(commits, theirs.id).some((t) => t.id === c.id),
      )
    : [];
  const contributed = sourceHistory.some((c) => c.authorId === userId);
  const roleOptions = directory.roles.filter(
    (r) =>
      !r.archivedAt &&
      r.capabilities.review &&
      !reviews.some((review) => review.roleId === r.id),
  );
  const heads =
    source && target
      ? { sourceHeadId: source.headId, targetHeadId: target.headId }
      : undefined;
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold break-words">{p.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={p.status === "merged" ? "good" : undefined}>
            <GitPullRequest className="size-3.5" />
            {p.status}
          </Badge>
          <span className="text-muted-foreground">
            {memberName(p.authorId)} proposes
          </span>
          <button
            className="rounded border bg-muted/30 px-2 py-0.5 font-mono text-xs hover:bg-muted"
            disabled={!source}
            onClick={() =>
              source && onNavigate({ kind: "branch", id: source.id })
            }
          >
            {sourceName}
          </button>
          <span>→</span>
          <span className="rounded border bg-muted/30 px-2 py-0.5 font-mono text-xs">
            {target?.name ?? "Deleted branch"}
          </span>
        </div>
      </div>
      <ErrorMessage message={error} />
      {deleting && (
        <DeletePrompt
          name={`pull request “${p.title}”`}
          pending={pending}
          onCancel={() => setDeleting(false)}
          onDelete={() =>
            void run(
              {
                type: "deletePullRequest",
                workItemId: item.id,
                pullRequestId: p.id,
              },
              () => onNavigate({ kind: "branches" }),
            )
          }
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <nav
            aria-label="Pull request views"
            className="flex flex-wrap gap-2 border-b pb-2"
          >
            {["conversation", "commits", "changes"].map((t) => (
              <Button
                key={t}
                variant={tab === t ? "secondary" : "ghost"}
                onClick={() => setTab(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </nav>
          {tab === "commits" ? (
            <CommitHistory
              commits={
                p.status === "merged" && merged
                  ? ancestry(commits, merged.id)
                  : sourceHistory
              }
              memberName={memberName}
            />
          ) : tab === "changes" ? (
            <>
              {display && before ? (
                <>
                  <p className="text-sm font-medium">
                    Resulting work item title: {display.title}
                  </p>
                  {display.title !== before.title && (
                    <p className="text-xs text-muted-foreground">
                      Previous title: {before.title}
                    </p>
                  )}
                  <RevisionDiff
                    before={before.content}
                    after={display.content}
                  />
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm">
                      Read the complete merge result
                    </summary>
                    <div className="mt-3">
                      <Markdown source={display.content} />
                    </div>
                  </details>
                  {!readOnly && p.status !== "merged" && ours && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setDraft({ section: "Merge result" });
                        setTab("conversation");
                      }}
                    >
                      Discuss this change
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The merge result is unavailable.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="rounded-lg border p-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  {memberName(p.authorId)} · {relativeTime(p.createdAt)}
                </p>
                <Markdown source={p.description} />
              </div>
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <SectionLabel>Discussions</SectionLabel>
                  <span className="text-xs text-muted-foreground">
                    {threads.filter((t) => t.status === "open").length} open
                  </span>
                </div>
                {threads.map((t) => (
                  <Thread key={t.id} thread={t} />
                ))}
                {!readOnly && p.status !== "merged" && ours && (
                  <ThreadComposer
                    draft={draft}
                    onDraftChange={setDraft}
                    pullRequestId={p.id}
                    commitId={ours.id}
                  />
                )}
              </section>
            </>
          )}
          {p.status !== "merged" && (
            <section className="space-y-3 rounded-lg border p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <GitMerge className="size-4" />
                Merge into {target?.name ?? "target"}
              </h2>
              {blockers.length ? (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {blockers.map((b) => (
                    <li key={b}>• {b}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-success">
                  Required reviews approve this merge result. No conflicts or
                  blocking discussions remain.
                </p>
              )}
              {(!result || result.conflicted) &&
                source &&
                ours &&
                theirs &&
                manage && (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setResolving(true)}
                  >
                    Resolve PR conflicts
                  </Button>
                )}
              {resolving && ours && theirs && source && target && (
                <ConflictResolver
                  key={`${ours.id}:${theirs.id}`}
                  base={common ?? { title: "", content: "" }}
                  ours={ours}
                  theirs={theirs}
                  pending={pending}
                  action="Commit resolution to source branch"
                  onCancel={() => setResolving(false)}
                  onResolve={(snapshot) =>
                    void run(
                      {
                        type: "syncBranch",
                        workItemId: item.id,
                        branchId: source.id,
                        targetId: target.id,
                        sourceHeadId: source.headId,
                        targetHeadId: target.headId,
                        ...snapshot,
                      },
                      () => setResolving(false),
                    )
                  }
                />
              )}
              <Button
                disabled={pending || !canMerge || blockers.length > 0 || !heads}
                onClick={() =>
                  heads &&
                  void run({
                    type: "mergePullRequest",
                    workItemId: item.id,
                    pullRequestId: p.id,
                    ...heads,
                  })
                }
              >
                <GitMerge className="size-3.5" />
                Merge pull request
              </Button>
            </section>
          )}
          {p.status === "merged" && (
            <p className="rounded-lg border border-success/30 p-4 text-sm text-success">
              Merged. The reviewed content is recorded in the target branch
              history.
              {automaticallyDeleted && (
                <> Lictory automatically deleted branch {sourceName}.</>
              )}
              {source &&
                target?.name === "main" &&
                prs.some(
                  (other) =>
                    other.id !== p.id &&
                    other.status !== "merged" &&
                    (other.sourceId === source.id ||
                      other.targetId === source.id),
                ) && (
                  <>
                    {" "}
                    The source branch is retained because another active pull
                    request uses it.
                  </>
                )}
            </p>
          )}
        </div>
        <aside className="space-y-5 rounded-lg border bg-muted/20 p-4">
          <LictoryActionCheck
            pullRequest={p}
            sourceHeadId={source?.headId}
            canCommit={Boolean(source?.collaboratorIds.includes(userId))}
          />
          <section className="space-y-3">
            <SectionLabel>Reviewers & checks</SectionLabel>
            {reviews.map((r) => {
              const role = directory.roles.find((role) => role.id === r.roleId),
                assigned =
                  role &&
                  !role.archivedAt &&
                  role.capabilities.review &&
                  role.userIds.includes(userId) &&
                  (!r.userId || r.userId === userId);
              const stale = Boolean(
                r.decision &&
                p.status !== "merged" &&
                (!result ||
                  result.conflicted ||
                  (Boolean(hash) && r.resultHash !== hash)),
              );
              return (
                <div key={r.id} className="space-y-2 border-b pb-3">
                  <p className="text-sm font-medium">
                    {role?.name ?? "Reviewer"}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {r.required ? "Required" : "Optional"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.userId
                      ? memberName(r.userId)
                      : "Any member of this role"}
                  </p>
                  <Badge
                    tone={valid(r) ? "good" : stale ? "warning" : undefined}
                  >
                    {stale
                      ? "Review required again"
                      : (r.decision ?? "Pending")}
                  </Badge>
                  {r.reviewerId && (
                    <p className="text-xs text-muted-foreground">
                      Decision by {memberName(r.reviewerId)}
                    </p>
                  )}
                  {assigned && !readOnly && p.status === "open" && heads && (
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          ["approve", "Approve"],
                          ["changes_requested", "Request changes"],
                          ["revoke", "Revoke"],
                        ] as const
                      ).map(([decision, label]) => (
                        <Button
                          key={decision}
                          size="sm"
                          variant={
                            decision === "approve" ? "primary" : "secondary"
                          }
                          disabled={
                            pending ||
                            !result ||
                            result.conflicted ||
                            (contributed && decision === "approve")
                          }
                          title={
                            contributed && decision === "approve"
                              ? "Contributors cannot approve their own changes."
                              : undefined
                          }
                          onClick={() =>
                            void run({
                              type: "decidePullRequest",
                              workItemId: item.id,
                              pullRequestId: p.id,
                              reviewId: r.id,
                              ...heads,
                              decision,
                            })
                          }
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {manage && capabilities.requestReviews && p.status !== "merged" && (
              <div className="space-y-2">
                <label className="block space-y-1 text-xs font-medium">
                  Request review
                  <DropdownSelect
                    placeholder="Choose a role…"
                    aria-label="PR reviewer role"
                    className="w-full"
                    value={roleId}
                    onValueChange={(value) => setRoleId(value)}
                  >
                    {roleOptions.map((r) => (
                      <DropdownSelectOption key={r.id} value={r.id}>
                        {r.name}
                      </DropdownSelectOption>
                    ))}
                  </DropdownSelect>
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || !roleId}
                  onClick={() =>
                    void run(
                      {
                        type: "requestPullRequestReview",
                        workItemId: item.id,
                        pullRequestId: p.id,
                        roleId,
                        userId: null,
                        required: true,
                      },
                      () => setRoleId(""),
                    )
                  }
                >
                  Request required review
                </Button>
              </div>
            )}
            {!reviews.length && (
              <p className="text-xs text-muted-foreground">
                Request the responsibilities needed to approve this change.
              </p>
            )}
          </section>
          {manage && p.status !== "merged" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() =>
                void run({
                  type: "setPullRequestDraft",
                  workItemId: item.id,
                  pullRequestId: p.id,
                  draft: p.status !== "draft",
                })
              }
            >
              {p.status === "draft" ? "Ready for review" : "Convert to draft"}
            </Button>
          )}
          {!readOnly &&
            (p.authorId === userId || capabilities.editSpecifications) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-3.5" />
                Delete pull request
              </Button>
            )}
        </aside>
      </div>
    </>
  );
}
