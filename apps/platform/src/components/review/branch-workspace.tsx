import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestCreate,
  GitMerge,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Plus,
  LockKeyhole,
  ChevronRight,
  MessageSquare,
  Users,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { byType, relativeTime } from "@lictory/core/lib/work-items";
import {
  BRANCH_NAME_MAX_LENGTH,
  branchNameProblem,
  finalizeBranchName,
  sanitizeBranchNameInput,
} from "@lictory/core/lib/branch-name";
import type { Command, EntityOf } from "@lictory/core/contracts/protocol";
import {
  proposedChildrenSchema,
  reviewResultValue,
  pendingEntries,
  sameProposedChildren,
} from "@lictory/core/contracts/decomposition";
import { BreakdownProposal } from "@lictory/platform/components/review/breakdown-proposal";
import {
  mergeBase,
  mergeSnapshot,
  type Snapshot,
  type MergeChunk,
} from "@lictory/core/contracts/merge";
import { Button } from "@lictory/ui/button";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { MarkdownEditor } from "@lictory/platform/components/ui/markdown-editor";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { RevisionDiff } from "@lictory/ui/diff";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Thread,
  ThreadComposer,
} from "@lictory/platform/components/review/threads";
import {
  ActionCheckRow,
  ActionChecksPanel,
  actionCheck,
  useAiRuns,
  useActionGate,
} from "@lictory/platform/components/review/ai-review";
import {
  BranchChip,
  CheckIcon,
  FlowSteps,
  NextStep,
  PrStatusIcon,
  PrStatusPill,
  Tabs,
  plural,
  prStatusMeta,
  type CheckState,
  type Step,
} from "@lictory/platform/components/review/flow-ui";

type Branch = EntityOf<"specBranch">;
type Commit = EntityOf<"specCommit">;
type PullRequest = EntityOf<"pullRequest">;
export type BranchScreen =
  | { kind: "branches" }
  | { kind: "branch"; id: string }
  | { kind: "pr"; id: string };
const field =
  "w-full rounded-md border border-input bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 touch:text-base";
const decisionLabel = {
  approved: "Approved",
  changes_requested: "Changes requested",
} as const;

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
const isMain = (b: Branch | undefined) => b?.name === "main";
// The pull request currently carrying a branch's work, if any.
const activePrFor = (prs: PullRequest[], branchId: string) =>
  prs
    .filter((p) => p.sourceId === branchId && p.status !== "merged")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
// Commits reachable from `head` that `target` does not contain yet.
function aheadOf(commits: Commit[], head: string, target: string | undefined) {
  const own = ancestry(commits, head);
  if (!target) return own;
  const theirs = new Set(ancestry(commits, target).map((c) => c.id));
  return own.filter((c) => !theirs.has(c.id));
}

// ─── Entry point on the specification page ─────────────────────────────────
export function BranchEntry({
  onNavigate,
}: {
  onNavigate: (screen: BranchScreen) => void;
}) {
  const { branches, prs, item, userId } = useBranchData();
  const active = prs
    .filter((p) => p.status !== "merged")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mine = branches.filter(
    (b) =>
      !isMain(b) &&
      (b.authorId === userId || b.collaboratorIds.includes(userId)) &&
      !activePrFor(prs, b.id),
  );
  return (
    <div className="my-6 overflow-hidden rounded-lg border text-[13px]">
      <div className="flex flex-wrap items-center gap-2 bg-muted/20 px-3 py-2">
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="font-medium">main</span>
        <span className="text-muted-foreground">
          Revision {item.revisionNumber}
        </span>
        {item.mainProtected && (
          <span title="This specification is ready. Changes go through a reviewed pull request.">
            <Badge>
              <LockKeyhole className="size-3" />
              Protected
            </Badge>
          </span>
        )}
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          onClick={() => onNavigate({ kind: "branches" })}
        >
          <GitPullRequest className="size-3.5" />
          Branches & pull requests
          {active.length ? ` (${active.length})` : ""}
        </Button>
      </div>
      {(active.length > 0 || mine.length > 0) && (
        <ul className="divide-y border-t">
          {active.slice(0, 3).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onNavigate({ kind: "pr", id: p.id })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
              >
                <PrStatusIcon status={p.status} />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="text-xs text-muted-foreground">
                  {prStatusMeta[p.status].label} pull request
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
          {mine.slice(0, 2).map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onNavigate({ kind: "branch", id: b.id })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
              >
                <GitBranch className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {b.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  Your branch · continue editing
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Workspace shell ───────────────────────────────────────────────────────
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
  const current =
    screen.kind === "branch"
      ? data.branches.find((b) => b.id === screen.id)?.name
      : screen.kind === "pr"
        ? data.prs.find((p) => p.id === screen.id)?.title
        : undefined;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-3 text-[13px]">
        <Button variant="ghost" size="sm" onClick={onMain}>
          <ArrowLeft className="size-3.5" />
          Main · revision {data.item.revisionNumber}
        </Button>
        <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-current={screen.kind === "branches" ? "page" : undefined}
            className={cn(screen.kind === "branches" && "text-foreground")}
            onClick={() => onNavigate({ kind: "branches" })}
          >
            Branches & pull requests
          </Button>
          {current && (
            <>
              <ChevronRight
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
              <span
                aria-current="page"
                className="max-w-64 truncate px-1 font-medium"
              >
                {current}
              </span>
            </>
          )}
        </nav>
        <span className="ml-auto" />
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
            .filter((b) => !isMain(b))
            .map((b) => (
              <DropdownSelectOption key={b.id} value={b.id}>
                {b.name}
              </DropdownSelectOption>
            ))}
        </DropdownSelect>
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

// ─── Overview ──────────────────────────────────────────────────────────────
function BranchOverview({
  onNavigate,
}: {
  onNavigate: (screen: BranchScreen) => void;
}) {
  const { branches, prs, commits, item, base, readOnly, memberName } =
    useBranchData();
  const { run, error, pending } = useAction();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [filter, setFilter] = useState<"active" | "merged">("active");
  const finalName = finalizeBranchName(name);
  // Only show problems that typing can't fix; trailing separators are trimmed on submit.
  const nameProblem = name
    ? (branchNameProblem(finalName) ??
      (branches.some((b) => b.name === finalName)
        ? "That branch name is already in use."
        : null))
    : null;
  const main = branches.find(isMain);
  const listed = prs
    .filter((p) =>
      filter === "merged" ? p.status === "merged" : p.status !== "merged",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const branchName = (id: string) =>
    branches.find((b) => b.id === id)?.name ?? "deleted branch";
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Branches & pull requests</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Propose changes to this specification without touching main. Edit on a
          branch, commit checkpoints, then open a pull request so the right
          people can review and merge it.
        </p>
      </div>
      <ErrorMessage message={error} />
      {!readOnly && (
        <form
          className="space-y-3 rounded-lg border p-4"
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
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="size-4" /> Start a change
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A branch is a separate draft of the specification: you and the
              collaborators you invite edit it while main stays unchanged.
              Everyone who can open this item can see its branches; nobody is
              asked to review anything until you open a pull request.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
              New branch name
              <input
                aria-label="New branch name"
                className={`${field} h-8`}
                value={name}
                onChange={(e) =>
                  setName(sanitizeBranchNameInput(e.target.value))
                }
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
            <label className="flex w-44 min-w-0 flex-col gap-1 text-xs font-medium">
              Branch from
              <DropdownSelect
                aria-label="Branch from"
                className="w-full"
                value={from}
                onValueChange={(value) => setFrom(value)}
              >
                <DropdownSelectOption value="">main</DropdownSelectOption>
                {branches
                  .filter((b) => !isMain(b))
                  .map((b) => (
                    <DropdownSelectOption key={b.id} value={b.id}>
                      {b.name}
                    </DropdownSelectOption>
                  ))}
              </DropdownSelect>
            </label>
            <Button
              type="submit"
              className="mt-5"
              disabled={pending || !name || !!nameProblem}
            >
              Create branch
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Pull requests</SectionLabel>
          <div
            role="group"
            aria-label="Pull request filter"
            className="flex rounded-md bg-muted p-0.5 text-xs"
          >
            {(
              [
                ["active", "Open", prs.filter((p) => p.status !== "merged")],
                ["merged", "Merged", prs.filter((p) => p.status === "merged")],
              ] as const
            ).map(([id, label, list]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-muted-foreground",
                  filter === id &&
                    "bg-card font-medium text-foreground shadow-(--shadow-border)",
                )}
              >
                {label} {list.length}
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y rounded-lg border">
          {listed.length ? (
            listed.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
                onClick={() => onNavigate({ kind: "pr", id: p.id })}
              >
                <PrStatusIcon status={p.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span className="font-mono">{branchName(p.sourceId)}</span>
                    <ArrowRight className="size-3" />
                    <span className="font-mono">{branchName(p.targetId)}</span>
                    <span>
                      · {memberName(p.authorId)} · {relativeTime(p.createdAt)}
                    </span>
                  </span>
                </span>
                <Badge tone={p.status === "open" ? "good" : undefined}>
                  {prStatusMeta[p.status].label}
                </Badge>
              </button>
            ))
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {filter === "merged"
                ? "Nothing merged yet."
                : "No open pull requests. Commit changes on a branch, then open one for review."}
            </p>
          )}
        </div>
      </section>
      <section className="space-y-2">
        <SectionLabel>Branches</SectionLabel>
        <div className="divide-y rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 text-sm">
            <GitBranch className="size-4" />
            <b>main</b>
            <Badge>Default</Badge>
            {item.mainProtected && (
              <Badge>
                <LockKeyhole className="size-3" />
                Protected
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              Revision {item.revisionNumber}
            </span>
          </div>
          {branches
            .filter((b) => !isMain(b))
            .map((b) => {
              const pr = activePrFor(prs, b.id);
              const ahead = aheadOf(commits, b.headId, main?.headId).length;
              return (
                <button
                  key={b.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
                  onClick={() => onNavigate({ kind: "branch", id: b.id })}
                >
                  <GitBranch className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-mono text-[13px] font-medium">
                      {b.name}
                    </b>
                    <span className="text-xs text-muted-foreground">
                      {memberName(b.authorId)} ·{" "}
                      {ahead
                        ? `${plural(ahead, "commit")} ahead of main`
                        : "no changes yet"}{" "}
                      · {plural(b.collaboratorIds.length, "collaborator")}
                    </span>
                  </span>
                  {pr ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <PrStatusIcon status={pr.status} className="size-3.5" />
                      {prStatusMeta[pr.status].label} PR
                    </span>
                  ) : ahead ? (
                    <span className="text-xs text-muted-foreground">
                      Ready to open a PR
                    </span>
                  ) : null}
                </button>
              );
            })}
          {branches.length <= 1 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No branches yet. Start a change to propose your first edit.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Branch: edit → commit → open pull request ─────────────────────────────
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
  if (!branch || !head)
    return (
      <div className="rounded-lg border border-dashed px-6 py-10 text-center">
        <p className="text-sm font-medium">This branch is unavailable.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          It was deleted, or merged and cleaned up. Its commits remain in
          history.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() => onNavigate({ kind: "branches" })}
        >
          See all branches
        </Button>
      </div>
    );
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
  const { branches, prs } = useBranchData();
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
          return {
            ...raw,
            proposedChildren: proposedChildrenSchema.parse(
              raw.proposedChildren ?? head.proposedChildren,
            ),
          };
      } catch {}
    return {
      title: head.title,
      content: head.content,
      proposedChildren: head.proposedChildren,
      baseCommitId: head.id,
      message: "",
    };
  });
  const [resolving, setResolving] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  const [tab, setTab] = useState<"document" | "changes" | "commits">(
    "document",
  );
  useEffect(() => {
    if (canEdit) localStorage.setItem(key, JSON.stringify(draft));
  }, [draft, key, canEdit]);
  const start = commits.find((c) => c.id === draft.baseCommitId) ?? head;
  const result = useMemo(
    () => mergeSnapshot(start, draft, head),
    [start, draft, head],
  );
  const changed =
    draft.title !== start.title ||
    draft.content !== start.content ||
    !sameProposedChildren(draft.proposedChildren, start.proposedChildren);
  const edit = (patch: Partial<Draft>) => {
    setCommitted(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const reset = () => {
    setDraft({
      title: head.title,
      content: head.content,
      proposedChildren: head.proposedChildren,
      baseCommitId: head.id,
      message: "",
    });
    setResolving(false);
  };
  const commit = (snapshot: Snapshot, resolve = false) => {
    const message = draft.message.trim();
    void run(
      {
        type: "commitBranch",
        workItemId: itemId,
        branchId: branch.id,
        baseCommitId: draft.baseCommitId,
        ...snapshot,
        message,
        ...(resolve ? { expectedHeadId: head.id } : {}),
      },
      () => {
        // The synchronized head is refreshed by mutate before it resolves. Start
        // the next draft from that committed snapshot on the next render.
        localStorage.removeItem(key);
        setDraft({
          ...(!resolve
            ? {
                title: result.title,
                content: result.content,
                proposedChildren: result.proposedChildren,
              }
            : snapshot),
          baseCommitId: head.id,
          message: "",
        });
        setResolving(false);
        setCommitted(message);
        setTab("document");
      },
    );
  };
  // A successful commit's snapshot can automatically advance its editor base
  // without replacing an in-progress draft when someone else commits.
  useEffect(() => {
    if (
      head.id !== draft.baseCommitId &&
      (!changed ||
        (head.title === draft.title &&
          head.content === draft.content &&
          sameProposedChildren(head.proposedChildren, draft.proposedChildren)))
    ) {
      // Reconcile a confirmed commit (or an idle editor) with the durable head.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({
        ...d,
        title: head.title,
        content: head.content,
        proposedChildren: head.proposedChildren,
        baseCommitId: head.id,
      }));
    }
  }, [
    head,
    changed,
    draft.title,
    draft.content,
    draft.proposedChildren,
    draft.baseCommitId,
  ]);
  const history = ancestry(commits, head.id);
  const main = branches.find(isMain);
  const mainHead = commits.find((c) => c.id === main?.headId);
  const pr = activePrFor(prs, branch.id);
  const prTarget = branches.find((b) => b.id === pr?.targetId);
  const ahead = aheadOf(commits, head.id, (prTarget ?? main)?.headId).length;
  // Where this branch is in its lifecycle.
  const stage = pr ? (changed ? 1 : 3) : changed ? 1 : ahead > 0 ? 2 : 0;
  const steps: Step[] = [
    "Edit",
    "Commit",
    "Open pull request",
    "Review & merge",
  ].map((label, i) => ({
    label,
    state:
      i === stage
        ? "current"
        : i < stage || (pr && i === 2)
          ? "done"
          : "upcoming",
  }));
  const openPrButton = (
    <Button
      variant={stage === 2 ? "primary" : "secondary"}
      disabled={!canEdit || pending || changed}
      title={
        changed
          ? "Commit or discard your edits first. A pull request reviews committed changes."
          : undefined
      }
      onClick={() => setOpening(true)}
    >
      <GitPullRequestCreate className="size-3.5" />
      Open pull request
    </Button>
  );
  const viewPrButton = pr && (
    <Button
      variant={stage === 3 ? "primary" : "secondary"}
      onClick={() => onNavigate({ kind: "pr", id: pr.id })}
    >
      <PrStatusIcon
        status={pr.status}
        className={stage === 3 ? "text-current" : undefined}
      />
      View pull request
    </Button>
  );
  const targetName = prTarget?.name ?? "main";
  const guidance = !canEdit ? (
    <NextStep title="You're viewing someone else's branch.">
      Ask {memberName(branch.authorId)} to invite you as a collaborator to
      commit changes.
    </NextStep>
  ) : committed && !changed ? (
    <NextStep
      tone="success"
      title={`Committed “${committed}” to ${branch.name}.`}
      action={pr ? viewPrButton : openPrButton}
    >
      {pr
        ? `Pull request “${pr.title}” now includes this commit. Reviewers will be asked to approve again.`
        : `${targetName} is unchanged. Open a pull request when you want this reviewed.`}
    </NextStep>
  ) : stage === 0 ? (
    <NextStep title="Edit the specification below.">
      Your edits are a draft saved in this browser. Commit them to record a
      checkpoint on this branch; main stays untouched.
    </NextStep>
  ) : stage === 1 ? (
    <NextStep tone="warning" title="You have uncommitted edits.">
      {pr
        ? `Commit them to update pull request “${pr.title}”. Reviewers will be asked to approve again.`
        : "Commit them to save a checkpoint on this branch. Only committed changes can be proposed in a pull request."}
    </NextStep>
  ) : stage === 2 ? (
    <NextStep
      title={`${plural(ahead, "commit")} on this branch ${ahead === 1 ? "isn't" : "aren't"} in main yet.`}
      action={openPrButton}
    >
      Open a pull request to ask for review. Nothing changes in main until it is
      approved and merged.
    </NextStep>
  ) : (
    pr && (
      <NextStep
        title={`Pull request “${pr.title}” is ${pr.status === "draft" ? "a draft" : "open for review"}.`}
        action={viewPrButton}
      >
        {pr.status === "draft"
          ? "Mark it ready for review when you're done. New commits are added to it automatically."
          : "New commits you make here are added to it automatically and ask reviewers to approve again."}
      </NextStep>
    )
  );
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
            <GitBranch className="size-5 shrink-0" />
            <span className="truncate">{branch.name}</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            {memberName(branch.authorId)}&apos;s branch ·{" "}
            {ahead
              ? `${plural(ahead, "commit")} ahead of ${targetName}`
              : `matches ${targetName}`}{" "}
            · last commit {relativeTime(head.createdAt)}
          </p>
          <FlowSteps steps={steps} />
        </div>
        <div className="flex items-center gap-1.5">
          {pr ? viewPrButton : stage !== 2 && openPrButton}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Delete branch"
              title="Delete branch"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <ErrorMessage message={error} />
      {deleting && (
        <DeletePrompt
          name={`branch ${branch.name}`}
          detail={
            pr
              ? "It has an active pull request; delete or merge that first."
              : changed
                ? "Your uncommitted edits will be lost."
                : undefined
          }
          pending={pending}
          onCancel={() => setDeleting(false)}
          onDelete={() =>
            void run(
              { type: "deleteBranch", workItemId: itemId, branchId: branch.id },
              () => {
                localStorage.removeItem(key);
                onNavigate({ kind: "branches" });
              },
            )
          }
        />
      )}
      {opening ? (
        <CreatePR
          source={branch}
          onCancel={() => setOpening(false)}
          onCreated={(id) => onNavigate({ kind: "pr", id })}
        />
      ) : (
        <>
          {guidance}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="min-w-0 space-y-4">
              <Tabs
                label="Branch views"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "document", label: "Document" },
                  { id: "changes", label: "Uncommitted", dot: changed },
                  { id: "commits", label: "Commits", count: history.length },
                ]}
              />
              {head.id !== start.id && changed && (
                <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
                  <p>
                    {result.conflicted
                      ? "Another commit overlaps your edits. Resolve the conflicts before committing."
                      : "This branch advanced while you were editing. Independent changes will be merged into your commit."}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setResolving(true)}
                    >
                      Compare & resolve
                    </Button>
                    <Button variant="ghost" size="sm" onClick={reset}>
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
                changed ? (
                  <>
                    {start.title !== draft.title && (
                      <p className="text-sm">
                        Title: {start.title} → {draft.title}
                      </p>
                    )}
                    <RevisionDiff
                      before={start.content}
                      after={draft.content}
                    />
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    No uncommitted edits. Everything on this branch is
                    committed.
                  </p>
                )
              ) : canEdit ? (
                <>
                  <label className="block space-y-1 text-xs font-medium">
                    Work item title
                    <input
                      aria-label="Branch work item title"
                      className={`${field} h-10 text-base font-semibold`}
                      value={draft.title}
                      onChange={(e) => edit({ title: e.target.value })}
                      maxLength={240}
                    />
                  </label>
                  <MarkdownEditor
                    aria-label="Branch specification"
                    fileContext={{ organizationId, workItemId: itemId }}
                    value={draft.content}
                    onValueChange={(content) => edit({ content })}
                    className="min-h-100 px-4 pt-4 font-mono"
                    previewClassName="min-h-[400px] px-4 pt-4"
                  />
                  <BreakdownProposal
                    proposals={draft.proposedChildren ?? []}
                    accepted={mainHead?.proposedChildren}
                    onChange={(proposedChildren) => edit({ proposedChildren })}
                  />
                </>
              ) : (
                <>
                  <h2 className="text-xl font-semibold">{head.title}</h2>
                  <Markdown source={head.content} />
                  <BreakdownProposal
                    proposals={head.proposedChildren}
                    accepted={mainHead?.proposedChildren}
                  />
                </>
              )}
              {canEdit && !resolving && (
                <CommitBox
                  branchName={branch.name}
                  changed={changed}
                  message={draft.message}
                  onMessage={(message) => setDraft((d) => ({ ...d, message }))}
                  conflicted={result.conflicted}
                  disabled={pending || !changed || !draft.title.trim()}
                  onDiscard={reset}
                  onCommit={() =>
                    result.conflicted ? setResolving(true) : commit(draft)
                  }
                  updatesPr={pr?.title}
                />
              )}
            </div>
            <aside className="space-y-5 text-sm">
              <section className="space-y-2">
                <SectionLabel>Latest commit</SectionLabel>
                <p className="flex gap-2 font-medium">
                  <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 wrap-break-word">
                    {head.message}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {memberName(head.authorId)} · {relativeTime(head.createdAt)}
                </p>
              </section>
              <section className="space-y-2">
                <SectionLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3" /> Collaborators
                  </span>
                </SectionLabel>
                <ul className="space-y-1.5">
                  {branch.collaboratorIds.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <Avatar userId={id} name={memberName(id)} />
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
                  <DropdownSelect
                    placeholder="Invite collaborator…"
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
                )}
                <p className="text-xs text-muted-foreground">
                  Collaborators can commit to this branch.
                </p>
              </section>
              <section className="space-y-2">
                <SectionLabel>Update from another branch</SectionLabel>
                <p className="text-xs text-muted-foreground">
                  Bring newer changes into this branch as a merge commit.
                </p>
                <SyncBranch
                  source={branch}
                  targets={branches.filter((b) => b.id !== branch.id)}
                  disabled={!canEdit || pending || changed}
                />
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

// The explicit "save a checkpoint" step, separated from editing.
function CommitBox({
  branchName,
  changed,
  message,
  onMessage,
  conflicted,
  disabled,
  onDiscard,
  onCommit,
  updatesPr,
}: {
  branchName: string;
  changed: boolean;
  message: string;
  onMessage: (message: string) => void;
  conflicted: boolean;
  disabled: boolean;
  onDiscard: () => void;
  onCommit: () => void;
  updatesPr: string | undefined;
}) {
  const ready = !disabled && message.trim().length > 0;
  return (
    <form
      aria-label="Commit changes"
      className={cn(
        "sticky bottom-3 z-10 space-y-2 rounded-lg border bg-card p-3 shadow-(--shadow-panel)",
        !changed && "shadow-none",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCommit();
      }}
    >
      <div className="flex items-center gap-2 text-xs">
        <GitCommitHorizontal className="size-4 text-muted-foreground" />
        <span className="font-medium">
          Commit to <span className="font-mono">{branchName}</span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {changed ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" />
              Uncommitted edits
            </span>
          ) : (
            "No uncommitted edits"
          )}
        </span>
      </div>
      <input
        aria-label="Commit message"
        className={`${field} h-8`}
        value={message}
        onChange={(e) => onMessage(e.target.value)}
        placeholder="Summarize what changed and why"
        maxLength={500}
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {updatesPr
            ? `Updates pull request “${updatesPr}”.`
            : "Main is not affected."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!changed}
          onClick={onDiscard}
        >
          Discard changes
        </Button>
        <Button type="submit" size="sm" disabled={!ready}>
          <GitCommitHorizontal className="size-3.5" />
          {conflicted ? "Resolve & commit" : "Commit changes"}
        </Button>
      </div>
    </form>
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
  if (!commits.length)
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        No commits.
      </p>
    );
  return (
    <ol className="relative space-y-0 border-l pl-5">
      {commits.map((c) => (
        <li key={c.id} className="relative py-2.5">
          <span
            aria-hidden
            className="absolute top-3.5 -left-6.25 grid size-3 place-items-center rounded-full border bg-background"
          >
            {c.parentIds.length > 1 && (
              <GitMerge className="size-2 text-muted-foreground" />
            )}
          </span>
          <p className="text-sm font-medium">{c.message}</p>
          <p className="text-xs text-muted-foreground">
            {memberName(c.authorId)} · {relativeTime(c.createdAt)}
            {c.parentIds.length > 1 ? " · Merge commit" : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ─── Open a pull request: a compare view, not an inline form ───────────────
function CreatePR({
  source,
  onCreated,
  onCancel,
}: {
  source: Branch;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const { branches, commits, item, memberName } = useBranchData();
  const { run, pending, error } = useAction();
  const [target, setTarget] = useState(branches.find(isMain)?.id ?? "");
  const targetBranch = branches.find((b) => b.id === target);
  const included = aheadOf(commits, source.headId, targetBranch?.headId);
  const [title, setTitle] = useState(
    included.length === 1 ? included[0]!.message.slice(0, 120) : "",
  );
  const [description, setDescription] = useState(
    included.length > 1
      ? included
          .slice()
          .reverse()
          .map((c) => `- ${c.message}`)
          .join("\n")
      : "",
  );
  const ours = commits.find((c) => c.id === source.headId);
  const theirs = commits.find((c) => c.id === targetBranch?.headId);
  const preview = useMemo(() => {
    if (!ours || !theirs) return undefined;
    const common = mergeBase(commits, ours.id, theirs.id);
    return common ? mergeSnapshot(common, ours, theirs) : undefined;
  }, [commits, ours, theirs]);
  const noChanges =
    preview &&
    !preview.conflicted &&
    preview.title === theirs?.title &&
    preview.content === theirs?.content &&
    sameProposedChildren(preview.proposedChildren, theirs?.proposedChildren);
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
  const disabled =
    pending || !title.trim() || !description.trim() || Boolean(noChanges);
  return (
    <section aria-labelledby="open-pr-heading" className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="open-pr-heading" className="text-lg font-semibold">
            Open a pull request
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ask reviewers to approve these changes. Nothing changes in{" "}
            {targetBranch?.name ?? "the target"} until the pull request is
            merged.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[13px]">
        <GitMerge className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Merge into</span>
        <DropdownSelect
          aria-label="PR target branch"
          className="w-48"
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
        <ArrowLeft className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">from</span>
        <BranchChip name={source.name} />
        <span className="ml-auto text-xs">
          {noChanges ? (
            <span className="text-muted-foreground">Nothing to compare</span>
          ) : preview?.conflicted ? (
            <span className="text-warning">
              Has conflicts — you can resolve them after opening
            </span>
          ) : (
            <span className="text-success">Can be merged cleanly</span>
          )}
        </span>
      </div>
      {noChanges ? (
        <NextStep
          title={`${source.name} has no changes compared to ${targetBranch?.name}.`}
        >
          Commit changes on this branch, or choose a different target.
        </NextStep>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <ErrorMessage message={error} />
            <label className="block space-y-1 text-xs font-medium">
              Title
              <input
                aria-label="Pull request title"
                className={`${field} h-9 text-sm`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What does this change do?"
                maxLength={120}
                autoFocus
              />
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Description
              <textarea
                aria-label="Pull request description"
                className={`${field} py-2`}
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={10000}
                placeholder="Why is this change needed? What should reviewers focus on?"
              />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="mr-auto text-[11px] text-muted-foreground">
                Drafts can&apos;t be approved or merged until you mark them
                ready.
              </p>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => submit(true)}
              >
                Create draft PR
              </Button>
              <Button disabled={disabled} onClick={() => submit(false)}>
                <GitPullRequestCreate className="size-3.5" />
                Create pull request
              </Button>
            </div>
            {preview && theirs && (
              <details className="rounded-lg border">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">
                  Preview the change
                </summary>
                <div className="space-y-2 border-t p-3">
                  {preview.title !== theirs.title && (
                    <p className="text-sm">
                      Title: {theirs.title} → {preview.title}
                    </p>
                  )}
                  <RevisionDiff
                    before={theirs.content}
                    after={preview.content}
                  />
                  <BreakdownProposal
                    includeApplied
                    proposals={pendingEntries(
                      preview.proposedChildren,
                      theirs.proposedChildren,
                    )}
                  />
                </div>
              </details>
            )}
          </div>
          <aside className="space-y-2">
            <SectionLabel>
              {plural(included.length, "commit")} included
            </SectionLabel>
            <CommitHistory commits={included} memberName={memberName} />
          </aside>
        </div>
      )}
    </section>
  );
}

function DeletePrompt({
  name,
  detail,
  pending,
  onCancel,
  onDelete,
}: {
  name: string;
  detail?: string;
  pending: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={`Delete ${name}`}
      className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex-1">
        Delete {name}? It will disappear from the workspace. Commits and
        activity remain in history.
        {detail && <span className="text-muted-foreground"> {detail}</span>}
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
  oursLabel = "Your changes",
  theirsLabel = "Current changes",
}: {
  oursLabel?: string;
  theirsLabel?: string;
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
  const [breakdownSide, setBreakdownSide] = useState<"ours" | "theirs" | null>(
    null,
  );
  const [choices, setChoices] = useState<Record<number, string[]>>({});
  const conflicts = result.chunks.flatMap((chunk, i) =>
    "lines" in chunk ? [] : [{ chunk, i }],
  );
  const complete =
    conflicts.every(({ i }) => choices[i] !== undefined) &&
    (!result.decompositionConflict || breakdownSide !== null) &&
    title.trim().length > 0;
  return (
    <section className="space-y-4 rounded-lg border border-warning/40 bg-card p-4">
      <h2 className="text-base font-semibold">Resolve changes</h2>
      <p className="text-sm text-muted-foreground">
        Both sides edited the same text. Pick what to keep for each conflict;
        edits that don&apos;t overlap are already combined.
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
          oursLabel={oursLabel}
          theirsLabel={theirsLabel}
          onChange={(value) => setChoices((c) => ({ ...c, [i]: value }))}
        />
      ))}
      {result.decompositionConflict && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            Both sides changed the proposed breakdown. Choose the complete
            breakdown to keep.
          </p>
          <div className="flex gap-2">
            <Button
              variant={breakdownSide === "ours" ? "primary" : "secondary"}
              onClick={() => setBreakdownSide("ours")}
            >
              Keep {oursLabel.toLowerCase()}
            </Button>
            <Button
              variant={breakdownSide === "theirs" ? "primary" : "secondary"}
              onClick={() => setBreakdownSide("theirs")}
            >
              Keep {theirsLabel.toLowerCase()}
            </Button>
          </div>
          <BreakdownProposal
            proposals={
              (breakdownSide === "theirs"
                ? theirs.proposedChildren
                : ours.proposedChildren) ?? []
            }
          />
        </div>
      )}
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
            onResolve({
              title: theirs.title,
              content: theirs.content,
              proposedChildren: theirs.proposedChildren ?? [],
            })
          }
        >
          Discard my changes
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            onResolve({
              title: ours.title,
              content: ours.content,
              proposedChildren: ours.proposedChildren ?? [],
            })
          }
        >
          Keep all my changes
        </Button>
        <Button
          disabled={pending || !complete}
          onClick={() =>
            onResolve({
              title,
              proposedChildren: result.decompositionConflict
                ? ((breakdownSide === "theirs"
                    ? theirs.proposedChildren
                    : ours.proposedChildren) ?? [])
                : result.proposedChildren,
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
  oursLabel,
  theirsLabel,
}: {
  oursLabel: string;
  theirsLabel: string;
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
            [oursLabel, chunk.ours],
            [theirsLabel, chunk.theirs],
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
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles from the dialog's controls to close it.
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Update ${source.name} from ${target?.name ?? "another branch"}`}
          onKeyDown={(e) => e.key === "Escape" && setResolving(false)}
          className="fixed inset-0 z-50 overflow-y-auto bg-background/95 p-4 md:p-12"
        >
          <div className="mx-auto max-w-5xl">
            <ConflictResolver
              key={`${ours.id}:${theirs.id}`}
              base={base ?? { title: "", content: "" }}
              ours={ours}
              theirs={theirs}
              pending={pending}
              action="Commit branch update"
              oursLabel={source.name}
              theirsLabel={target?.name ?? "Other branch"}
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
  const serialized = snapshot ? reviewResultValue(snapshot) : "";
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

// ─── Pull request ──────────────────────────────────────────────────────────
type MergeRow = {
  key: string;
  state: CheckState;
  text: string;
  detail?: ReactNode;
  action?: ReactNode;
};
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
  const { directory, projects } = useWorkspace();
  const disciplines = directory.disciplines.filter(
    (d) => d.projectId === item.projectId,
  );
  const { run, error, pending } = useAction();
  const [tab, setTab] = useState<
    "conversation" | "commits" | "checks" | "changes"
  >("conversation");
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
  const actionRuns = useAiRuns("pr_action", id);
  if (!p)
    return (
      <div className="rounded-lg border border-dashed px-6 py-10 text-center">
        <p className="text-sm font-medium">This pull request is unavailable.</p>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() => onNavigate({ kind: "branches" })}
        >
          See all pull requests
        </Button>
      </div>
    );
  const mergeActivity = activity.find(
    (a) =>
      a.action === "pull_request_merged" && a.detail?.pullRequestId === p.id,
  );
  const sourceName =
    source?.name ??
    (typeof mergeActivity?.detail?.source === "string"
      ? mergeActivity.detail.source
      : "Deleted branch");
  const targetName = target?.name ?? "Deleted branch";
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
  const openBlocking = threads.filter(
    (t) => t.blocking && t.status === "open",
  ).length;
  const manage =
    !readOnly &&
    (p.authorId === userId || source?.collaboratorIds.includes(userId));
  const required = reviews.filter((r) => r.required);
  const valid = (r: EntityOf<"prReview">) =>
    r.decision === "approved" &&
    r.resultHash === hash &&
    Boolean(hash) &&
    disciplines.some(
      (role) =>
        role.id === r.disciplineId &&
        !role.archivedAt &&
        role.capabilities.review &&
        role.userIds.includes(r.reviewerId ?? ""),
    );
  const roleName = (id: string) =>
    disciplines.find((role) => role.id === id)?.name ?? "Reviewer";
  const conflicted = !result || result.conflicted;
  const noChanges =
    result &&
    !result.conflicted &&
    result.title === theirs?.title &&
    result.content === theirs?.content &&
    sameProposedChildren(result.proposedChildren, theirs?.proposedChildren);
  const changesRequested = reviews.some(
    (r) => r.decision === "changes_requested" && r.resultHash === hash,
  );
  const pendingRequired = required.filter((r) => !valid(r));
  const blockers = [
    ...(p.status === "draft" ? ["This pull request is a draft."] : []),
    ...(conflicted ? ["The branches have merge conflicts."] : []),
    ...(noChanges ? ["This branch has no changes to merge."] : []),
    ...(!required.length ? ["Request at least one required review."] : []),
    ...pendingRequired.map(
      (r) =>
        `${roleName(r.disciplineId)} approval ${r.decision === "approved" && r.resultHash !== hash ? "is stale" : "is pending"}.`,
    ),
    ...(changesRequested ? ["A reviewer requested changes."] : []),
    ...(openBlocking ? ["Blocking discussions remain open."] : []),
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
    (isMain(target)
      ? capabilities.editSpecifications
      : target.collaboratorIds.includes(userId));
  const sourceHistory = ours ? aheadOf(commits, ours.id, theirs?.id) : [];
  const shownHistory =
    p.status === "merged" && merged
      ? ancestry(commits, merged.id)
      : sourceHistory;
  const contributed = sourceHistory.some((c) => c.authorId === userId);
  const roleOptions = disciplines.filter(
    (r) =>
      !r.archivedAt &&
      r.capabilities.review &&
      !reviews.some((review) => review.disciplineId === r.id),
  );
  const heads =
    source && target
      ? { sourceHeadId: source.headId, targetHeadId: target.headId }
      : undefined;
  const policy =
    projects.find((x) => x.id === item.projectId)?.aiActionPolicy ?? "advisory";
  const latestRun = actionRuns.find((r) => r.status !== "superseded");
  const checkState = actionCheck(latestRun, source?.headId, policy).state;
  const willDeleteSource =
    source &&
    !prs.some(
      (other) =>
        other.id !== p.id &&
        other.status !== "merged" &&
        (other.sourceId === source.id || other.targetId === source.id),
    );
  const setDraftState = (draft: boolean) =>
    void run({
      type: "setPullRequestDraft",
      workItemId: item.id,
      pullRequestId: p.id,
      draft,
    });

  // GitHub-style merge box: one row per requirement, grouped by concern.
  const rows: MergeRow[] = [];
  if (!required.length)
    rows.push({
      key: "no-review",
      state: "failure",
      text: "Request at least one required review.",
      detail: "Choose who must approve in Reviewers.",
    });
  // Name the condition and who can resolve it: a stale approval needs a new
  // look at the changed result, a pending one needs a first decision.
  for (const r of pendingRequired) {
    const stale = r.decision === "approved" && r.resultHash !== hash;
    const who = r.reviewerId ? memberName(r.reviewerId) : undefined;
    rows.push({
      key: `review-${r.id}`,
      state: "pending",
      text: `${roleName(r.disciplineId)} approval ${stale ? "is stale" : "is pending"}${who ? ` · ${who}` : ""}`,
      detail: stale
        ? "The merge result changed since the approval. Ask for another review."
        : "Waiting for a decision on this exact merge result.",
    });
  }
  if (changesRequested)
    rows.push({
      key: "changes",
      state: "failure",
      text: "A reviewer requested changes.",
      detail: "Address the feedback with a new commit, then ask again.",
    });
  if (required.length && !pendingRequired.length && !changesRequested)
    rows.push({
      key: "reviews-ok",
      state: "success",
      text: `${plural(required.length, "required review")} approved this exact result.`,
    });
  if (actionGate)
    rows.push({
      key: "action-gate",
      state: latestRun?.status === "failed" ? "failure" : "pending",
      text: actionGate,
      action: (
        <Button size="sm" variant="ghost" onClick={() => setTab("checks")}>
          Details
        </Button>
      ),
    });
  rows.push(
    openBlocking
      ? {
          key: "threads",
          state: "failure",
          text: "Blocking discussions remain open.",
          detail: `${plural(openBlocking, "blocking discussion")} must be resolved first.`,
        }
      : {
          key: "threads-ok",
          state: "success",
          text: "No blocking discussions.",
        },
  );
  rows.push(
    conflicted
      ? {
          key: "conflicts",
          state: "failure",
          text: "The branches have merge conflicts.",
          detail: `${sourceName} and ${targetName} changed the same text. Resolving adds a commit to ${sourceName}, so reviewers approve again.`,
          action: source && ours && theirs && manage && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setResolving(true)}
            >
              Resolve conflicts
            </Button>
          ),
        }
      : noChanges
        ? {
            key: "empty",
            state: "neutral",
            text: "This branch has no changes to merge.",
          }
        : {
            key: "clean",
            state: "success",
            text: `No conflicts with ${targetName}.`,
          },
  );
  if (p.status === "draft")
    rows.unshift({
      key: "draft",
      state: "neutral",
      text: "This pull request is a draft.",
      detail: "Reviewers can comment, but it can't be approved or merged yet.",
      action: manage && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setDraftState(false)}
        >
          Ready for review
        </Button>
      ),
    });
  const mergeEffect = isMain(target)
    ? `Merging publishes this result as revision ${item.revisionNumber + 1} of the specification. Approvals carry over to that revision${willDeleteSource ? `, and ${sourceName} is deleted` : ""}.`
    : `Merging adds this result to ${targetName} as a merge commit. Main is not affected.`;

  return (
    <>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold wrap-break-word">{p.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <PrStatusPill status={p.status} />
          <span className="font-medium">{memberName(p.authorId)}</span>
          <span className="text-muted-foreground">
            {p.status === "merged" ? "merged" : "wants to merge"}{" "}
            {plural(sourceHistory.length || shownHistory.length, "commit")} into
          </span>
          <BranchChip name={targetName} />
          <span className="text-muted-foreground">from</span>
          <BranchChip
            name={sourceName}
            muted={!source}
            onClick={
              source
                ? () => onNavigate({ kind: "branch", id: source.id })
                : undefined
            }
          />
        </div>
      </header>
      <ErrorMessage message={error} />
      {deleting && (
        <DeletePrompt
          name={`pull request “${p.title}”`}
          detail={
            p.status === "merged"
              ? "The merged content stays in the specification."
              : "The branch is kept."
          }
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
      <Tabs
        label="Pull request views"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: "conversation",
            label: "Conversation",
            icon: <MessageSquare className="size-3.5" />,
            count: threads.length,
          },
          {
            id: "commits",
            label: "Commits",
            icon: <GitCommitHorizontal className="size-3.5" />,
            count: shownHistory.length,
          },
          {
            id: "checks",
            label: "Actions",
            icon: actionRuns.length ? (
              <CheckIcon state={checkState} className="size-3.5" />
            ) : (
              <IntelligenceMark className="size-3.5" />
            ),
          },
          { id: "changes", label: "Changes" },
        ]}
      />
      {tab === "checks" ? (
        <ActionChecksPanel
          pullRequest={p}
          sourceHeadId={source?.headId}
          sourceName={sourceName}
          canCommit={Boolean(source?.collaboratorIds.includes(userId))}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-4">
            {/* What blocks the merge comes first, before the conversation. */}
            {p.status !== "merged" ? (
              <section
                aria-label="Merge status"
                className={cn(
                  "overflow-hidden rounded-lg border",
                  !blockers.length && "border-success/40",
                )}
              >
                <div className="flex items-start gap-3 border-b px-4 py-3">
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full",
                      blockers.length
                        ? "bg-muted text-muted-foreground"
                        : "bg-success text-white",
                    )}
                  >
                    <GitMerge className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold">
                      {blockers.length
                        ? "Merging is blocked"
                        : "Ready to merge"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {blockers.length
                        ? `${plural(blockers.length, "requirement")} into ${targetName} not met yet.`
                        : "Required reviews approve this merge result. No conflicts or blocking discussions remain."}
                    </p>
                  </div>
                </div>
                {actionRuns.length > 0 && !actionGate && (
                  <div className="border-b px-4 py-2.5">
                    <ActionCheckRow
                      pullRequestId={p.id}
                      sourceHeadId={source?.headId}
                      onDetails={() => setTab("checks")}
                    />
                  </div>
                )}
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li
                      key={r.key}
                      className="flex items-start gap-2.5 px-4 py-2.5 text-[13px]"
                    >
                      <CheckIcon state={r.state} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p>{r.text}</p>
                        {r.detail && (
                          <p className="text-xs text-muted-foreground">
                            {r.detail}
                          </p>
                        )}
                      </div>
                      {r.action}
                    </li>
                  ))}
                </ul>
                {resolving && ours && theirs && source && target && (
                  <div className="border-t p-4">
                    <ConflictResolver
                      key={`${ours.id}:${theirs.id}`}
                      base={common ?? { title: "", content: "" }}
                      ours={ours}
                      theirs={theirs}
                      pending={pending}
                      action={`Commit resolution to ${sourceName}`}
                      oursLabel={`${sourceName} (this pull request)`}
                      theirsLabel={targetName}
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
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-4 py-3">
                  <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {canMerge
                      ? mergeEffect
                      : `You can't merge into ${targetName}. ${isMain(target) ? "Merging into main needs permission to edit specifications." : `Only collaborators on ${targetName} can merge.`}`}
                  </p>
                  <Button
                    disabled={
                      pending || !canMerge || blockers.length > 0 || !heads
                    }
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
                </div>
              </section>
            ) : (
              <section className="flex items-start gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-violet-600 text-white">
                  <GitMerge className="size-4" />
                </span>
                <p className="text-sm">
                  Merged. The reviewed content is recorded in the target branch
                  history.
                  {automaticallyDeleted && (
                    <> Lictory automatically deleted branch {sourceName}.</>
                  )}
                  {source && isMain(target) && !willDeleteSource && (
                    <>
                      {" "}
                      The source branch is retained because another active pull
                      request uses it.
                    </>
                  )}
                </p>
              </section>
            )}
            {tab === "commits" ? (
              <CommitHistory commits={shownHistory} memberName={memberName} />
            ) : tab === "changes" ? (
              display && before ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm">
                      <span className="text-muted-foreground">
                        Resulting work item title:
                      </span>{" "}
                      <span className="font-medium">{display.title}</span>
                      {display.title !== before.title && (
                        <span className="block text-xs text-muted-foreground">
                          Previous title: {before.title}
                        </span>
                      )}
                    </p>
                    {!readOnly && p.status !== "merged" && ours && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDraft({ section: "Merge result" });
                          setTab("conversation");
                        }}
                      >
                        <MessageSquare className="size-3.5" />
                        Discuss this change
                      </Button>
                    )}
                  </div>
                  <RevisionDiff
                    before={before.content}
                    after={display.content}
                  />
                  <BreakdownProposal
                    includeApplied
                    proposals={pendingEntries(
                      display.proposedChildren,
                      before.proposedChildren,
                    )}
                  />
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm">
                      Read the complete merge result
                    </summary>
                    <div className="mt-3">
                      <Markdown source={display.content} />
                    </div>
                  </details>
                </>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  The merge result is unavailable until the conflicts are
                  resolved.
                </p>
              )
            ) : (
              <>
                <article className="overflow-hidden rounded-lg border">
                  <p className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    <Avatar userId={p.authorId} name={memberName(p.authorId)} />
                    <span className="font-medium text-foreground">
                      {memberName(p.authorId)}
                    </span>
                    opened this {relativeTime(p.createdAt)}
                  </p>
                  <div className="p-4">
                    <Markdown source={p.description} />
                  </div>
                </article>
                {display && (
                  <BreakdownProposal
                    includeApplied
                    proposals={pendingEntries(
                      display.proposedChildren,
                      before?.proposedChildren,
                    )}
                  />
                )}
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
          </div>
          <aside className="space-y-5 text-sm">
            <section className="space-y-2">
              <SectionLabel>Reviewers</SectionLabel>
              {!reviews.length && (
                <p className="text-xs text-muted-foreground">
                  No reviewers yet. Request the responsibilities that must
                  approve this change.
                </p>
              )}
              <ul className="space-y-3">
                {reviews.map((r) => {
                  const role = disciplines.find(
                      (role) => role.id === r.disciplineId,
                    ),
                    assigned =
                      role &&
                      !role.archivedAt &&
                      role.capabilities.review &&
                      role.userIds.includes(userId) &&
                      (!r.userId || r.userId === userId);
                  const stale = Boolean(
                    r.decision &&
                    p.status !== "merged" &&
                    (conflicted || (Boolean(hash) && r.resultHash !== hash)),
                  );
                  const state: CheckState = valid(r)
                    ? "success"
                    : stale
                      ? "pending"
                      : r.decision === "changes_requested"
                        ? "failure"
                        : "neutral";
                  return (
                    <li key={r.id} className="space-y-1.5">
                      <div className="flex items-start gap-2">
                        <CheckIcon state={state} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {role?.name ?? "Reviewer"}{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              {r.required ? "Required" : "Optional"}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.userId
                              ? memberName(r.userId)
                              : `Any ${role?.name ?? "role"} member`}
                          </p>
                        </div>
                        <Badge
                          tone={
                            valid(r)
                              ? "good"
                              : stale
                                ? "warning"
                                : r.decision === "changes_requested"
                                  ? "danger"
                                  : undefined
                          }
                        >
                          {stale
                            ? "Review required again"
                            : r.decision
                              ? decisionLabel[r.decision]
                              : "Pending"}
                        </Badge>
                      </div>
                      {r.reviewerId && (
                        <p className="pl-6 text-xs text-muted-foreground">
                          Decision by {memberName(r.reviewerId)}
                        </p>
                      )}
                      {assigned &&
                        !readOnly &&
                        p.status === "open" &&
                        heads && (
                          <div className="flex flex-wrap gap-1 pl-6">
                            {(
                              [
                                ["approve", "Approve"],
                                ["changes_requested", "Request changes"],
                                ...(r.decision
                                  ? ([["revoke", "Revoke"]] as const)
                                  : []),
                              ] as const
                            ).map(([decision, label]) => (
                              <Button
                                key={decision}
                                size="sm"
                                variant={
                                  decision === "approve"
                                    ? "primary"
                                    : decision === "revoke"
                                      ? "ghost"
                                      : "secondary"
                                }
                                disabled={
                                  pending ||
                                  conflicted ||
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
                    </li>
                  );
                })}
              </ul>
              {manage &&
                capabilities.requestReviews &&
                p.status !== "merged" &&
                roleOptions.length > 0 && (
                  <div className="flex gap-1.5">
                    <DropdownSelect
                      placeholder="Add a reviewing discipline…"
                      aria-label="PR reviewing discipline"
                      className="min-w-0 flex-1"
                      value={roleId}
                      onValueChange={(value) => setRoleId(value)}
                    >
                      {roleOptions.map((r) => (
                        <DropdownSelectOption key={r.id} value={r.id}>
                          {r.name}
                        </DropdownSelectOption>
                      ))}
                    </DropdownSelect>
                    <Button
                      size="md"
                      variant="secondary"
                      disabled={pending || !roleId}
                      aria-label="Request required review"
                      title="Request required review"
                      onClick={() =>
                        void run(
                          {
                            type: "requestPullRequestReview",
                            workItemId: item.id,
                            pullRequestId: p.id,
                            disciplineId: roleId,
                            userId: null,
                            required: true,
                          },
                          () => setRoleId(""),
                        )
                      }
                    >
                      Request
                    </Button>
                  </div>
                )}
              {p.status === "open" && (
                <p className="text-[11px] text-muted-foreground">
                  Approvals apply to the exact merge result. Any new commit on
                  either branch asks reviewers again.
                </p>
              )}
            </section>
            <section className="space-y-2">
              <SectionLabel>Lictory Actions</SectionLabel>
              {actionRuns.length || policy !== "off" ? (
                <ActionCheckRow
                  pullRequestId={p.id}
                  sourceHeadId={source?.headId}
                  onDetails={() => setTab("checks")}
                />
              ) : (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setTab("checks")}
                >
                  No Lictory Actions have run on this pull request.
                </button>
              )}
            </section>
            <section className="space-y-2 border-t pt-4">
              {manage && p.status === "open" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  disabled={pending}
                  onClick={() => setDraftState(true)}
                >
                  <GitPullRequest className="size-3.5" />
                  Convert to draft
                </Button>
              )}
              {!readOnly &&
                (p.authorId === userId || capabilities.editSpecifications) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start hover:text-destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete pull request
                  </Button>
                )}
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
