import { ItemScreenTitle } from "@lictory/platform/components/items/screen-title";
import { MissingState } from "@lictory/ui/status-page";
import { Tabs as TabsRoot } from "@ui-sdk/react/tabs";
import { Actor } from "@lictory/platform/components/identity/actor";
import {
  MergeBox,
  MergedNotice,
  type MergeRequirement,
} from "@lictory/platform/components/review/merge-box";
import {
  PullRequestHeader,
  PullRequestTabs,
} from "@lictory/platform/components/review/pull-request-header";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { toast } from "@lictory/ui/toast";
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
  ListTree,
  Send,
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
  pullRequestIsActive,
  specificationPullRequest,
} from "@lictory/core/contracts/state-machines";
import {
  proposedChildrenSchema,
  reviewResultValue,
  pendingEntries,
  sameProposedChildren,
  isNewChild,
} from "@lictory/core/contracts/decomposition";
import { BreakdownProposal } from "@lictory/platform/components/review/breakdown-proposal";
import {
  mergeBase,
  mergeSnapshot,
  type Snapshot,
  type MergeChunk,
} from "@lictory/core/contracts/merge";
import { Button, buttonClass } from "@lictory/ui/button";
import { dialogBackdropClass, dialogPanelClass } from "@lictory/ui/dialog";
import { popupContainer } from "@lictory/ui/popup";
import { Badge, SectionLabel } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { RevisionDiff } from "@lictory/ui/diff";
import { SpecDiff } from "@lictory/platform/components/review/spec-diff";
import { useItem } from "@lictory/platform/components/items/item-context";
import {
  SpecificationDraftEditor,
  useSpecificationDraft,
} from "@lictory/platform/components/items/specification-draft";
import type { LiveControls } from "@lictory/platform/components/items/live-specification";
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
  BranchName,
  CheckIcon,
  FlowSteps,
  NextStep,
  PrStatusIcon,
  TabPanel,
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
// "Propose breakdown" means: edit the delivery breakdown on a branch. Rather
// than leaving the person on the branch list to name one, it reopens their
// breakdown branch or starts one from main, and the branch editor scrolls to
// the breakdown. The request is consumed once by the editor it names.
let breakdownFocus: string | null = null;

export function useProposeBreakdown(
  onNavigate: (screen: BranchScreen) => void,
) {
  const { branches, userId, base, mutateConfirmed } = useBranchData();
  return async () => {
    const mine = branches.find(
      (b) => b.authorId === userId && isBreakdownBranch(b),
    );
    if (mine) {
      breakdownFocus = mine.id;
      onNavigate({ kind: "branch", id: mine.id });
      return;
    }
    let name = "breakdown";
    for (let n = 2; branches.some((b) => b.name === name); n++)
      name = `breakdown-${n}`;
    const id = crypto.randomUUID();
    try {
      await mutateConfirmed({
        type: "createBranch",
        ...base,
        branchId: id,
        name,
      });
      breakdownFocus = id;
      onNavigate({ kind: "branch", id });
    } catch (error) {
      // Say why, then offer the branch list to start one by hand.
      toast({
        title: "Could not start a breakdown",
        type: "error",
        description:
          error instanceof Error ? error.message : "The server refused it.",
        duration: 8000,
      });
      onNavigate({ kind: "branches" });
    }
  };
}

// "Suggest a change" on selected specification text: start a branch from
// main and open its editor with that text selected, ready to rewrite. The
// request is consumed once by the editor it names.
let suggestionFocus: { branchId: string; quote: string } | null = null;

export function useSuggestChange(onNavigate: (screen: BranchScreen) => void) {
  const { branches, base, mutateConfirmed } = useBranchData();
  return async (quote: string) => {
    let name = "suggestion";
    for (let n = 2; branches.some((b) => b.name === name); n++)
      name = `suggestion-${n}`;
    const id = crypto.randomUUID();
    try {
      await mutateConfirmed({
        type: "createBranch",
        ...base,
        branchId: id,
        name,
      });
      suggestionFocus = { branchId: id, quote };
      onNavigate({ kind: "branch", id });
    } catch (error) {
      toast({
        title: "Could not start a suggestion",
        type: "error",
        description:
          error instanceof Error ? error.message : "The server refused it.",
        duration: 8000,
      });
    }
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
// Specification people read a line of work in requirements words, not Git
// ones: main is the specification itself, any other branch a proposed
// change (by its name), a commit a saved version, a pull request a review,
// and a merge applies it (AGENTS.md, "Git-style semantics"). Agent
// tools keep the Git names.
const lineName = (b: Branch | undefined) =>
  !b ? "a deleted change" : isMain(b) ? "the specification" : b.name;
const lineLabel = (b: Branch | undefined) =>
  !b ? "Deleted change" : isMain(b) ? "Current specification" : b.name;
// The pull request currently carrying a branch's work, if any.
const activePrFor = (prs: PullRequest[], branchId: string) =>
  prs
    .filter((p) => p.sourceId === branchId && pullRequestIsActive(p))
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
    .filter(pullRequestIsActive)
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
        <span className="font-medium">Revision {item.revisionNumber}</span>
        <span className="text-muted-foreground">current specification</span>
        {item.mainProtected && (
          <span title="This specification is ready. Changes are proposed and reviewed before they apply.">
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
          Proposed changes
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
                  {prStatusMeta[p.status].label}
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
                  Your change · continue editing
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
  nav,
}: {
  screen: BranchScreen;
  onNavigate: (screen: BranchScreen) => void;
  onMain: () => void;
  // The specification's history views, above the branch list.
  nav?: ReactNode;
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
      {screen.kind === "branches" && nav}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-3 text-[13px]">
        <Button variant="ghost" size="sm" onClick={onMain}>
          <ArrowLeft className="size-3.5" />
          Revision {data.item.revisionNumber}
        </Button>
        <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
        {/* Inside the item's page, whose header holds the page's own
            breadcrumb: this one is named for what it walks. */}
        <nav
          aria-label="Specification changes"
          className="flex min-w-0 items-center gap-1.5"
        >
          <Button
            variant="ghost"
            size="sm"
            aria-current={screen.kind === "branches" ? "page" : undefined}
            className={cn(screen.kind === "branches" && "text-foreground")}
            onClick={() => onNavigate({ kind: "branches" })}
          >
            Proposed changes
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
        ? "That name is already in use."
        : null))
    : null;
  const main = branches.find(isMain);
  const listed = prs
    .filter((p) =>
      filter === "merged" ? p.status === "merged" : p.status !== "merged",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const branchName = (id: string) =>
    lineName(branches.find((b) => b.id === id));
  return (
    <>
      <div>
        <ItemScreenTitle>Proposed changes</ItemScreenTitle>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Propose changes to this specification without touching its current
          revision. Edit a change with the people you invite, save versions,
          then send it for review: once the required reviewers approve, it
          applies as the next revision.
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
              A change is a separate draft of the specification: you and the
              collaborators you invite edit it while the current revision stays
              as it is. Everyone who can open this item can see it; nobody is
              asked to review anything until you send it for review.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
              Name of the change
              <Input
                aria-label="Name of the change"
                className={`${field} h-8`}
                value={name}
                onValueChange={(value) =>
                  setName(sanitizeBranchNameInput(value))
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
              Start from
              <DropdownSelect
                aria-label="Start from"
                className="w-full"
                value={from}
                onValueChange={(value) => setFrom(value)}
              >
                <DropdownSelectOption value="">
                  Current specification
                </DropdownSelectOption>
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
              Start change
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Reviews</SectionLabel>
          <ToggleGroup<"active" | "merged">
            aria-label="Review filter"
            value={[filter]}
            onValueChange={([next]) => {
              if (next) setFilter(next);
            }}
            deselectable={false}
            className="flex rounded-md bg-muted p-0.5 text-xs"
          >
            {(
              [
                ["active", "Open", prs.filter((p) => p.status !== "merged")],
                ["merged", "Applied", prs.filter((p) => p.status === "merged")],
              ] as const
            ).map(([id, label, list]) => (
              <Toggle
                key={id}
                value={id}
                className="rounded-md px-2 py-0.5 text-muted-foreground data-pressed:bg-card data-pressed:font-medium data-pressed:text-foreground data-pressed:shadow-(--shadow-border)"
              >
                {label} {list.length}
              </Toggle>
            ))}
          </ToggleGroup>
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
                    <span>{branchName(p.targetId)}</span>
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
                ? "Nothing applied yet."
                : "Nothing in review. Save a version of a change, then send it for review."}
            </p>
          )}
        </div>
      </section>
      <section className="space-y-2">
        <SectionLabel>Changes</SectionLabel>
        <div className="divide-y rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 text-sm">
            <GitBranch className="size-4" />
            <b>Current specification</b>
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
                        ? `${plural(ahead, "version")} not in the specification yet`
                        : "no changes yet"}{" "}
                      · {plural(b.collaboratorIds.length, "collaborator")}
                    </span>
                  </span>
                  {pr ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <PrStatusIcon status={pr.status} className="size-3.5" />
                      {prStatusMeta[pr.status].label}
                    </span>
                  ) : ahead ? (
                    <span className="text-xs text-muted-foreground">
                      Ready to send for review
                    </span>
                  ) : null}
                </button>
              );
            })}
          {branches.length <= 1 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No proposed changes yet. Start one to propose your first edit.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Branch: edit → commit → open pull request ─────────────────────────────
type Draft = Snapshot & { baseCommitId: string; message: string };
// The person's own part of a branch edit, kept in this browser: the
// breakdown they are changing (from `baseCommitId`) and the commit message.
// Title and content are the branch's shared live draft. A draft saved here
// before live editing whose text differs from its commit is handed to the
// live editor as kept text, never dropped.
function loadBranchDraft(key: string, head: Commit, commits: Commit[]) {
  const fresh: Draft = {
    title: head.title,
    content: head.content,
    proposedChildren: head.proposedChildren,
    baseCommitId: head.id,
    message: "",
  };
  if (typeof window === "undefined") return { draft: fresh, legacy: null };
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    if (
      raw &&
      typeof raw.title === "string" &&
      typeof raw.content === "string" &&
      typeof raw.baseCommitId === "string" &&
      typeof raw.message === "string"
    ) {
      const base = commits.find((c) => c.id === raw.baseCommitId) ?? head;
      const legacy =
        raw.content !== base.content || raw.title !== base.title
          ? { title: raw.title, content: raw.content }
          : null;
      return {
        draft: {
          ...raw,
          title: base.title,
          content: base.content,
          proposedChildren: proposedChildrenSchema.parse(
            raw.proposedChildren ?? base.proposedChildren,
          ),
        },
        legacy,
      };
    }
  } catch {}
  return { draft: fresh, legacy: null };
}
// Reports the live draft's uncommitted state to the branch screen.
function Uncommitted({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  useEffect(() => onChange(value), [value, onChange]);
  return null;
}
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
        <p className="text-sm font-medium">
          This proposed change is unavailable.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          It was deleted, or applied and closed. Its versions remain in history.
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          onClick={() => onNavigate({ kind: "branches" })}
        >
          See all proposed changes
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
  const { directory, items: workItems } = useWorkspace();
  const { branches, prs, item, mutateConfirmed } = useBranchData();
  const { run, error, pending } = useAction();
  // A breakdown proposal ("Propose breakdown") speaks the language of the
  // work it proposes: items sent for review, then created. The branch,
  // commit and pull request underneath keep the reviewed-breakdown rule.
  const isBreakdown = isBreakdownBranch(branch);
  // The breakdown sits below the live editor, which loads on its own: focus
  // moves there once it has mounted.
  const [focusBreakdown, setFocusBreakdown] = useState(false);
  useEffect(() => {
    if (breakdownFocus !== branch.id || !canEdit) return;
    breakdownFocus = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes a one-time request from the "Propose breakdown" action
    setFocusBreakdown(true);
  }, [branch.id, canEdit]);
  const breakdownRef = useCallback(
    (section: HTMLDivElement | null) => {
      if (!section || !focusBreakdown) return;
      setFocusBreakdown(false);
      requestAnimationFrame(() => {
        section.scrollIntoView({ block: "center" });
        section
          .querySelector<HTMLInputElement>(
            "input:not([type=hidden], [aria-hidden=true])",
          )
          ?.focus({ preventScroll: true });
      });
    },
    [focusBreakdown],
  );
  // The passage from "Suggest a change", selected by the live editor once
  // it can be edited; the request is consumed only when it was selected.
  const [suggestedQuote, setSuggestedQuote] = useState(() =>
    suggestionFocus?.branchId === branch.id ? suggestionFocus.quote : undefined,
  );
  const quoteSelected = useCallback(() => {
    if (suggestionFocus?.branchId === branch.id) suggestionFocus = null;
    setSuggestedQuote(undefined);
  }, [branch.id]);
  const key = `lictory:branch-draft:${userId}:${organizationId}:${itemId}:${branch.id}`;
  const [initial] = useState(() => loadBranchDraft(key, head, commits));
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [legacy, setLegacy] = useState(initial.legacy);
  const [liveChanged, setLiveChanged] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [sealError, setSealError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const liveDraft = useSpecificationDraft(branch.id);
  const [opening, setOpening] = useState(false);
  const [committed, setCommitted] = useState<string | null>(null);
  const [tab, setTab] = useState<"document" | "changes" | "commits">(
    "document",
  );
  useEffect(() => {
    if (canEdit) localStorage.setItem(key, JSON.stringify(draft));
  }, [draft, key, canEdit]);
  const start = commits.find((c) => c.id === draft.baseCommitId) ?? head;
  const breakdownChanged = !sameProposedChildren(
    draft.proposedChildren,
    start.proposedChildren,
  );
  const changed = canEdit && (liveChanged || breakdownChanged);
  const resetBreakdown = () =>
    setDraft((d) => ({
      ...d,
      title: head.title,
      content: head.content,
      proposedChildren: head.proposedChildren,
      baseCommitId: head.id,
    }));
  // "Commit": seals the shared draft's stored cut, with this person's
  // breakdown edits when they made any.
  const commit = (
    controls: LiveControls,
    then?: (outcome: "saved" | "nothing") => Promise<void>,
    message = draft.message.trim(),
  ) => {
    if (!liveDraft || sealing) return;
    setSealing(true);
    setSealError("");
    void controls
      .seal((expectedSequence) => ({
        type: "commitSpecificationDraft",
        workItemId: itemId,
        draftId: liveDraft.id,
        epoch: liveDraft.epoch,
        expectedSequence,
        message,
        ...(breakdownChanged
          ? {
              proposedChildren: draft.proposedChildren,
              breakdownBaseCommitId: draft.baseCommitId,
            }
          : {}),
      }))
      .then(async (outcome) => {
        setDraft((d) => ({ ...d, message: "" }));
        if (outcome === "saved") setCommitted(message);
        setTab("document");
        await then?.(outcome);
      })
      .catch((e: unknown) =>
        setSealError(
          e instanceof Error ? e.message : "The version could not be saved.",
        ),
      )
      .finally(() => setSealing(false));
  };
  // Breakdown edits start from the head they were made on; an untouched
  // breakdown (or one the head now equals) follows the branch.
  useEffect(() => {
    if (
      head.id !== draft.baseCommitId &&
      (!breakdownChanged ||
        sameProposedChildren(head.proposedChildren, draft.proposedChildren))
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft((d) => ({
        ...d,
        title: head.title,
        content: head.content,
        proposedChildren: head.proposedChildren,
        baseCommitId: head.id,
      }));
    }
  }, [head, breakdownChanged, draft.proposedChildren, draft.baseCommitId]);
  const history = ancestry(commits, head.id);
  const main = branches.find(isMain);
  const mainHead = commits.find((c) => c.id === main?.headId);
  const pr = activePrFor(prs, branch.id);
  const prTarget = branches.find((b) => b.id === pr?.targetId);
  const ahead = aheadOf(commits, head.id, (prTarget ?? main)?.headId).length;
  // Where this branch is in its lifecycle.
  const stage = pr ? (changed ? 1 : 3) : changed ? 1 : ahead > 0 ? 2 : 0;
  // A breakdown has three: propose the items, send them for review, and
  // the reviewed items are created.
  const breakdownStage = pr && !changed ? 2 : changed || ahead > 0 ? 1 : 0;
  const steps: Step[] = isBreakdown
    ? ["Propose items", "Send for review", "Reviewed, then created"].map(
        (label, i) => ({
          label,
          state:
            i === breakdownStage
              ? "current"
              : i < breakdownStage
                ? "done"
                : "upcoming",
        }),
      )
    : ["Edit", "Save a version", "Send for review", "Review & apply"].map(
        (label, i) => ({
          label,
          state:
            i === stage
              ? "current"
              : i < stage || (pr && i === 2)
                ? "done"
                : "upcoming",
        }),
      );
  // Sends the proposed items for review in one step: saves the edits, if
  // any, and opens the review against main (the specification's reviewers
  // are asked). Later edits update the open review.
  const proposed = (draft.proposedChildren ?? [])
    .filter(isNewChild)
    .filter((child) => !workItems.some((w) => w.id === child.workItemId));
  const openReview = async () => {
    const main = branches.find(isMain);
    if (!main) throw new Error("The specification is still loading.");
    const id = crypto.randomUUID();
    await mutateConfirmed({
      type: "createPullRequest",
      workItemId: itemId,
      pullRequestId: id,
      sourceId: branch.id,
      targetId: main.id,
      title: `Breakdown: ${item.title}`.slice(0, 120),
      // The items themselves are listed under it; the description says
      // what is asked, not the list again.
      description: proposed.length
        ? `Proposes ${plural(proposed.length, "new item")} to deliver ${item.title}.`
        : "Changes to the delivery breakdown.",
      draft: false,
    });
    onNavigate({ kind: "pr", id });
  };
  const sendForReview = (controls: LiveControls) => {
    if (changed)
      return commit(
        controls,
        async () => {
          if (!pr) await openReview();
        },
        pr ? "Update the proposed breakdown" : "Propose breakdown",
      );
    if (!pr && ahead > 0)
      void openReview().catch((e: unknown) =>
        setSealError(
          e instanceof Error ? e.message : "The review could not be opened.",
        ),
      );
  };
  const openPrButton = (
    <Button
      variant={stage === 2 ? "primary" : "secondary"}
      disabled={!canEdit || pending || changed}
      title={
        changed
          ? "Save or discard your edits first. A review covers saved versions only."
          : undefined
      }
      onClick={() => setOpening(true)}
    >
      <GitPullRequestCreate className="size-3.5" />
      Send for review
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
      View review
    </Button>
  );
  const targetName = lineName(prTarget ?? main);
  const breakdownGuidance = !canEdit ? (
    <NextStep title="You're viewing someone else's breakdown proposal.">
      Ask {memberName(branch.authorId)} to invite you to edit it.
    </NextStep>
  ) : pr && !changed ? (
    <NextStep
      title={`The breakdown is ${pr.status === "draft" ? "a draft" : "waiting for review"}.`}
      action={viewPrButton}
    >
      The items are created once the specification&apos;s reviewers approve it.
      Changes you make here update the review and ask them again.
    </NextStep>
  ) : (
    <NextStep title="Propose the items that deliver this specification.">
      Edits are saved as you type and shared with the people you invite. Nothing
      is created until the specification&apos;s reviewers approve the breakdown.
    </NextStep>
  );
  const guidance = isBreakdown ? (
    breakdownGuidance
  ) : !canEdit ? (
    <NextStep title="You're viewing someone else's proposed change.">
      Ask {memberName(branch.authorId)} to invite you as a collaborator to edit
      it.
    </NextStep>
  ) : committed && !changed ? (
    <NextStep
      tone="success"
      title={`Saved version “${committed}”.`}
      action={pr ? viewPrButton : openPrButton}
    >
      {pr
        ? `Review “${pr.title}” now includes this version. Reviewers will be asked to approve again.`
        : `Nothing changed in ${targetName}. Send this change for review when you want it approved.`}
    </NextStep>
  ) : stage === 0 ? (
    <NextStep title="Edit the specification below.">
      Edits are saved as you type and shared with this change&apos;s
      collaborators. Save a version to record a checkpoint; the current
      specification stays untouched.
    </NextStep>
  ) : stage === 1 ? (
    <NextStep tone="warning" title="Your edits are not in a version yet.">
      {pr
        ? `Save a version to update review “${pr.title}”. Reviewers will be asked to approve again.`
        : "Save a version to record a checkpoint. Only saved versions can be sent for review."}
    </NextStep>
  ) : stage === 2 ? (
    <NextStep
      title={`${plural(ahead, "saved version")} ${ahead === 1 ? "isn't" : "aren't"} in ${targetName} yet.`}
      action={openPrButton}
    >
      Send it for review. Nothing changes in {targetName} until the required
      reviewers approve and someone applies it.
    </NextStep>
  ) : (
    pr && (
      <NextStep
        title={`Review “${pr.title}” is ${pr.status === "draft" ? "a draft" : "open"}.`}
        action={viewPrButton}
      >
        {pr.status === "draft"
          ? "Mark it ready for review when you're done. New versions are added to it automatically."
          : "New versions you save here are added to it automatically and ask reviewers to approve again."}
      </NextStep>
    )
  );
  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {isBreakdown ? (
            <>
              <ItemScreenTitle className="flex items-center gap-2 text-lg">
                <ListTree aria-hidden className="size-5 shrink-0" />
                <span className="truncate">Breakdown of {item.title}</span>
              </ItemScreenTitle>
              <p className="text-xs text-muted-foreground">
                Proposed by {memberName(branch.authorId)} · saved{" "}
                {relativeTime(head.createdAt)}
              </p>
            </>
          ) : (
            <>
              <ItemScreenTitle className="flex items-center gap-2 font-mono text-lg">
                <GitBranch aria-hidden className="size-5 shrink-0" />
                <span className="truncate">{branch.name}</span>
              </ItemScreenTitle>
              <p className="text-xs text-muted-foreground">
                {memberName(branch.authorId)}&apos;s proposed change ·{" "}
                {ahead
                  ? `${plural(ahead, "version")} not in ${targetName} yet`
                  : `matches ${targetName}`}{" "}
                · last saved {relativeTime(head.createdAt)}
              </p>
            </>
          )}
          <FlowSteps steps={steps} />
        </div>
        <div className="flex items-center gap-1.5">
          {pr ? viewPrButton : !isBreakdown && stage !== 2 && openPrButton}
          {canDelete && (
            <DeletePrompt
              name={`change ${branch.name}`}
              detail={
                pr
                  ? "It is in review; apply or delete the review first."
                  : changed
                    ? "Edits not in a version yet will be lost."
                    : undefined
              }
              onDelete={() =>
                run(
                  {
                    type: "deleteBranch",
                    workItemId: itemId,
                    branchId: branch.id,
                  },
                  () => {
                    localStorage.removeItem(key);
                    onNavigate({ kind: "branches" });
                  },
                )
              }
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Delete change"
                  title="Delete change"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
          )}
        </div>
      </div>
      <ErrorMessage message={error || sealError} />
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
            <Tabs
              className="min-w-0 space-y-4"
              label="Change views"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "document", label: "Document" },
                { id: "changes", label: "New edits", dot: changed },
                { id: "commits", label: "Versions", count: history.length },
              ]}
            >
              {canEdit ? (
                // One panel serves both views of the editor and stays
                // mounted on every tab, so switching tabs keeps the live
                // session (and the carets) open.
                <TabPanel
                  keepMounted
                  value={tab === "changes" ? "changes" : "document"}
                  className="space-y-4"
                >
                  <SpecificationDraftEditor
                    branchId={branch.id}
                    line={{
                      headTitle: head.title,
                      headMarkdown: head.content,
                      basedOn: "the latest version",
                      isMain: false,
                      branchName: branch.name,
                    }}
                    label="Proposed specification"
                    titleLabel="Proposed work item title"
                    legacyText={legacy}
                    onLegacyKept={() => setLegacy(null)}
                    fileContext={{ organizationId, workItemId: itemId }}
                    minHeight="25rem"
                    view={tab === "changes" ? "changes" : "document"}
                    selectText={suggestedQuote}
                    onTextSelected={quoteSelected}
                    onClose={() => onNavigate({ kind: "branches" })}
                    footer={(controls) => (
                      <>
                        <Uncommitted
                          value={controls.uncommitted}
                          onChange={setLiveChanged}
                        />
                        <div
                          ref={breakdownRef}
                          hidden={tab !== "document"}
                          className="scroll-mt-24"
                        >
                          <BreakdownProposal
                            proposals={draft.proposedChildren ?? []}
                            accepted={mainHead?.proposedChildren}
                            onChange={(proposedChildren) => {
                              setCommitted(null);
                              setDraft((d) => ({ ...d, proposedChildren }));
                            }}
                          />
                        </div>
                        {tab === "changes" && breakdownChanged && (
                          <p className="text-sm text-muted-foreground">
                            The proposed breakdown changed too; it is saved with
                            the text.
                          </p>
                        )}
                        {confirmDiscard && (
                          <div
                            role="alert"
                            className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
                          >
                            <p className="min-w-0 flex-1 basis-60">
                              Discard the edits not in a version yet, for
                              everyone editing this change? Saved versions are
                              kept.
                            </p>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={sealing}
                              onClick={() => {
                                setConfirmDiscard(false);
                                resetBreakdown();
                                if (controls.uncommitted)
                                  void controls
                                    .discard()
                                    .catch((e: unknown) =>
                                      setSealError(
                                        e instanceof Error
                                          ? e.message
                                          : "The changes could not be discarded.",
                                      ),
                                    );
                              }}
                            >
                              Discard changes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDiscard(false)}
                            >
                              Keep them
                            </Button>
                          </div>
                        )}
                        {isBreakdown ? (
                          <SendBreakdown
                            changed={changed}
                            inReview={Boolean(pr)}
                            items={proposed.length}
                            disabled={
                              pending ||
                              sealing ||
                              !controls.editable ||
                              (pr ? !changed : !changed && ahead === 0)
                            }
                            onDiscard={() => setConfirmDiscard(true)}
                            onSend={() => sendForReview(controls)}
                          />
                        ) : (
                          <CommitBox
                            branchName={branch.name}
                            changed={changed}
                            message={draft.message}
                            onMessage={(message) =>
                              setDraft((d) => ({ ...d, message }))
                            }
                            conflicted={false}
                            disabled={
                              pending ||
                              sealing ||
                              !changed ||
                              !controls.editable
                            }
                            onDiscard={() => setConfirmDiscard(true)}
                            onCommit={() => commit(controls)}
                            updatesPr={pr?.title}
                          />
                        )}
                      </>
                    )}
                  />
                </TabPanel>
              ) : (
                <>
                  <TabPanel value="document" className="space-y-4">
                    <h2 className="text-xl font-semibold">{head.title}</h2>
                    <Markdown source={head.content} />
                    <BreakdownProposal
                      proposals={head.proposedChildren}
                      accepted={mainHead?.proposedChildren}
                    />
                  </TabPanel>
                  <TabPanel value="changes">
                    <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      No new edits. Everything in this change is in a saved
                      version.
                    </p>
                  </TabPanel>
                </>
              )}
              <TabPanel value="commits">
                <CommitHistory commits={history} memberName={memberName} />
              </TabPanel>
            </Tabs>
            <aside className="space-y-5 text-sm">
              <section className="space-y-2">
                <SectionLabel>Latest version</SectionLabel>
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
                      <Actor userId={id} label="none" size={20} />
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
                  Collaborators can edit this change.
                </p>
              </section>
              <section className="space-y-2">
                <SectionLabel>Bring in newer text</SectionLabel>
                <p className="text-xs text-muted-foreground">
                  Bring what changed in the specification, or in another change,
                  into this one.
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

// The breakdown's one action: send the proposed items for review (or
// update the review already open), without commit messages.
function SendBreakdown({
  changed,
  inReview,
  items,
  disabled,
  onDiscard,
  onSend,
}: {
  changed: boolean;
  inReview: boolean;
  items: number;
  disabled: boolean;
  onDiscard: () => void;
  onSend: () => void;
}) {
  return (
    <form
      aria-label="Send breakdown for review"
      className={cn(
        "sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-(--shadow-panel) max-sm:static max-sm:shadow-none",
        !changed && "shadow-none",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSend();
      }}
    >
      <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
        {inReview
          ? changed
            ? "Your changes are not in the review yet."
            : "The review has every change."
          : `${plural(items, "proposed item")}. The specification's reviewers approve the breakdown before the items are created.`}
      </p>
      <Button variant="ghost" size="sm" disabled={!changed} onClick={onDiscard}>
        Discard changes
      </Button>
      <Button type="submit" size="sm" disabled={disabled}>
        <Send aria-hidden className="size-3.5" />
        {inReview ? "Update the review" : "Send for review"}
      </Button>
    </form>
  );
}

export const isBreakdownBranch = (branch: { name: string } | undefined) =>
  Boolean(branch && /^breakdown(-\d+)?$/.test(branch.name));

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
      aria-label="Save a version"
      className={cn(
        // Sticky where there is room beside the fields; on phones the bar
        // would cover the field being edited, so it ends the form instead.
        "sticky bottom-3 z-10 space-y-2 rounded-lg border bg-card p-3 shadow-(--shadow-panel) max-sm:static max-sm:shadow-none",
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
          Save a version of <span className="font-mono">{branchName}</span>
        </span>
        <span className="ml-auto text-muted-foreground">
          {changed ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" />
              Not in a version yet
            </span>
          ) : (
            "Nothing new to save"
          )}
        </span>
      </div>
      <Input
        aria-label="What changed?"
        className={`${field} h-8`}
        value={message}
        onValueChange={(value) => onMessage(value)}
        placeholder="Summarize what changed and why"
        maxLength={500}
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {updatesPr
            ? `Updates review “${updatesPr}”.`
            : "The specification is not affected."}
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
          {conflicted ? "Resolve & save" : "Save version"}
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
        No versions.
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
            {c.parentIds.length > 1 ? " · Brought in newer text" : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ─── Send for review (a pull request): a compare view, not an inline form ──
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
            Send for review
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ask reviewers to approve this change. Nothing changes in{" "}
            {lineName(targetBranch)} until the review is approved and applied.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[13px]">
        <GitMerge className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">Apply to</span>
        <DropdownSelect
          aria-label="Apply to"
          className="w-48"
          value={target}
          onValueChange={(value) => setTarget(value)}
        >
          {branches
            .filter((b) => b.id !== source.id)
            .map((b) => (
              <DropdownSelectOption key={b.id} value={b.id}>
                {lineLabel(b)}
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
              Conflicts with newer text — resolve them after sending
            </span>
          ) : (
            <span className="text-success">Applies cleanly</span>
          )}
        </span>
      </div>
      {noChanges ? (
        <NextStep
          title={`${source.name} has no changes compared to ${lineName(targetBranch)}.`}
        >
          Save a version of this change, or choose a different target.
        </NextStep>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <ErrorMessage message={error} />
            <label className="block space-y-1 text-xs font-medium">
              Title
              <Input
                aria-label="Review title"
                className={`${field} h-9 text-sm`}
                value={title}
                onValueChange={(value) => setTitle(value)}
                placeholder="What does this change do?"
                maxLength={120}
                autoFocus
              />
            </label>
            <label className="block space-y-1 text-xs font-medium">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (required)
              </span>
              <Textarea
                aria-label="Review description"
                required
                className={`${field} py-2`}
                rows={5}
                value={description}
                onValueChange={(value) => setDescription(value)}
                maxLength={10000}
                placeholder="Why is this change needed? What should reviewers focus on?"
              />
            </label>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="mr-auto text-xs text-muted-foreground">
                Drafts can&apos;t be approved or applied until you mark them
                ready.
              </p>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => submit(true)}
              >
                Save as draft
              </Button>
              <Button disabled={disabled} onClick={() => submit(false)}>
                <GitPullRequestCreate className="size-3.5" />
                Send for review
              </Button>
            </div>
            {preview && theirs && (
              <Collapsible className="rounded-lg border">
                <CollapsibleTrigger className="group/preview flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium">
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 text-muted-foreground transition-transform group-data-open/preview:rotate-90"
                  />
                  Preview the change
                </CollapsibleTrigger>
                <CollapsiblePanel className="space-y-2 border-t p-3">
                  {preview.title !== theirs.title && (
                    <p className="text-sm">
                      Title: {theirs.title} → {preview.title}
                    </p>
                  )}
                  <SpecDiff
                    before={theirs.content}
                    after={preview.content}
                    beforeLabel={lineLabel(targetBranch)}
                    afterLabel="This change"
                  />
                  <BreakdownProposal
                    includeApplied
                    proposals={pendingEntries(
                      preview.proposedChildren,
                      theirs.proposedChildren,
                    )}
                  />
                </CollapsiblePanel>
              </Collapsible>
            )}
          </div>
          <aside className="space-y-2">
            <SectionLabel>
              {plural(included.length, "version")} included
            </SectionLabel>
            <CommitHistory commits={included} memberName={memberName} />
          </aside>
        </div>
      )}
    </section>
  );
}

// Asks before deleting. Confirming keeps the question open until the server
// has answered; a refusal is reported by the screen behind it.
function DeletePrompt({
  name,
  detail,
  onDelete,
  trigger,
}: {
  name: string;
  detail?: string;
  onDelete: () => Promise<void>;
  // The button that asks.
  trigger: ReactElement<Record<string, unknown>>;
}) {
  return (
    <AlertDialog container={popupContainer()}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogBackdrop className={dialogBackdropClass} />
      <AlertDialogContent
        className={cn(dialogPanelClass, "max-w-md gap-0 p-5")}
      >
        <AlertDialogTitle className="m-0 text-sm font-semibold">
          Delete {name}
          <span aria-hidden>?</span>
        </AlertDialogTitle>
        <AlertDialogDescription className="mt-1 mb-0 text-[13px] leading-5 text-muted-foreground">
          It will disappear from the workspace. Saved versions and activity
          remain in history.{detail && ` ${detail}`}
        </AlertDialogDescription>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <AlertDialogClose className={buttonClass({ variant: "ghost" })}>
            Cancel
          </AlertDialogClose>
          <AlertDialogClose
            value="confirm"
            action={onDelete}
            className={buttonClass({ variant: "danger" })}
          >
            Delete
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
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
          <Input
            aria-label="Resolved title"
            className={`${field} h-8`}
            value={title}
            onValueChange={(value) => setTitle(value)}
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
        <Textarea
          aria-label={`Resolved conflict ${number}`}
          className={`${field} font-mono`}
          rows={4}
          value={value.join("\n")}
          onValueChange={(text) => onChange(text ? text.split("\n") : [])}
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
        aria-label="Bring in text from"
        className="w-full"
        value={targetId}
        disabled={disabled}
        onValueChange={(value) => setTargetId(value)}
      >
        {targets.map((b) => (
          <DropdownSelectOption key={b.id} value={b.id}>
            {lineLabel(b)}
          </DropdownSelectOption>
        ))}
      </DropdownSelect>
      <Dialog
        open={resolving && Boolean(ours && theirs)}
        onOpenChange={setResolving}
        container={popupContainer()}
      >
        <DialogTrigger
          disabled={
            disabled || pending || !target || target.headId === source.headId
          }
          render={<Button size="sm" variant="secondary" />}
        >
          Compare & update
        </DialogTrigger>
        <DialogContent className="fixed inset-0 z-50 block h-auto max-h-none w-auto overflow-y-auto rounded-none bg-background/95 p-4 text-sm text-foreground shadow-none outline-none md:p-12">
          <DialogTitle className="sr-only">
            Update {source.name} from {lineName(target)}
          </DialogTitle>
          <div className="mx-auto max-w-5xl">
            {/* The page behind is inert while this is open: a refused update
                explains itself here, where the person is working. */}
            <div className="mb-3 empty:mb-0">
              <ErrorMessage message={error} />
            </div>
            {ours && theirs && (
              <ConflictResolver
                key={`${ours.id}:${theirs.id}`}
                base={base ?? { title: "", content: "" }}
                ours={ours}
                theirs={theirs}
                pending={pending}
                action="Save the update"
                oursLabel={source.name}
                theirsLabel={lineLabel(target)}
                onCancel={() => setResolving(false)}
                onResolve={sync}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
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
type MergeRow = MergeRequirement;
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
      <MissingState
        illustration="search"
        headingLevel={2}
        title="This review is unavailable"
        action={
          <Button
            variant="secondary"
            onClick={() => onNavigate({ kind: "branches" })}
          >
            See all proposed changes
          </Button>
        }
      >
        The link may be wrong, or the review belongs to another item.
      </MissingState>
    );
  const mergeActivity = activity.find(
    (a) =>
      a.action === "pull_request_merged" && a.detail?.pullRequestId === p.id,
  );
  const sourceName =
    source?.name ??
    (typeof mergeActivity?.detail?.source === "string"
      ? mergeActivity.detail.source
      : "a deleted change");
  const targetName = lineName(target);
  const targetLabel = lineLabel(target);
  // A breakdown into main reads as one: items proposed, reviewed, created.
  const breakdown =
    isBreakdownBranch({ name: sourceName }) && (!target || isMain(target));
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
    ...(p.status === "draft" ? ["This review is a draft."] : []),
    ...(conflicted ? ["This change conflicts with newer text."] : []),
    ...(noChanges ? ["This change has nothing left to apply."] : []),
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
  // A merged pull request shows the commits it brought in: those reachable
  // from the merge's source parent but not from its target parent (the
  // source branch itself is gone after the merge). Not main's whole history.
  const shownHistory =
    p.status === "merged" && merged
      ? merged.parentIds[1]
        ? aheadOf(commits, merged.parentIds[1], merged.parentIds[0])
        : ancestry(commits, merged.id)
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
        pullRequestIsActive(other) &&
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
        ? "The result changed since the approval. Ask for another review."
        : "Waiting for a decision on this exact result.",
    });
  }
  if (changesRequested)
    rows.push({
      key: "changes",
      state: "failure",
      text: "A reviewer requested changes.",
      detail: "Address the feedback in a new version, then ask again.",
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
          text: "This change conflicts with newer text.",
          detail: `${sourceName} and ${targetName} changed the same text. Resolving saves a new version of ${sourceName}, so reviewers approve again.`,
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
            text: "This change has nothing left to apply.",
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
      text: "This review is a draft.",
      detail: "Reviewers can comment, but it can't be approved or applied yet.",
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
  const mergeEffect = breakdown ? (
    <>
      Creating them records this breakdown as revision {item.revisionNumber + 1}{" "}
      of the specification. Approvals carry over to that revision.
    </>
  ) : isMain(target) ? (
    <>
      Applying makes this result revision {item.revisionNumber + 1} of the
      specification. Approvals carry over to that revision
      {willDeleteSource && (
        <>
          , and the change <BranchName>{sourceName}</BranchName> is closed
        </>
      )}
      .
    </>
  ) : (
    <>
      Applying adds this result to <BranchName>{targetName}</BranchName> as a
      new version. The specification is not affected.
    </>
  );

  return (
    <TabsRoot
      className="block space-y-6"
      value={tab}
      onValueChange={(next: typeof tab | null) => next && setTab(next)}
    >
      <PullRequestHeader
        // The pull request takes the item's place under the item's bar.
        headingLevel={1}
        title={p.title}
        state={p.status}
        stateLabel={prStatusMeta[p.status].label}
        author={<Actor userId={p.authorId} size={20} />}
        mergedBy={
          mergeActivity && mergeActivity.actorId !== p.authorId ? (
            <Actor userId={mergeActivity.actorId} size={20} />
          ) : undefined
        }
        commits={sourceHistory.length || shownHistory.length}
        summary={
          breakdown ? (
            p.status === "merged" ? (
              `created the breakdown of ${item.title}`
            ) : (
              `proposes a breakdown of ${item.title}`
            )
          ) : (
            <>
              {p.status === "merged" ? "applied" : "proposes"}{" "}
              <BranchChip
                name={sourceName}
                muted={!source}
                onClick={
                  source
                    ? () => onNavigate({ kind: "branch", id: source.id })
                    : undefined
                }
              />{" "}
              {p.status === "merged" ? "to" : "for"} {targetName}
            </>
          )
        }
        base={targetName}
        head={sourceName}
        headGone={!source}
        onHeadClick={
          source
            ? () => onNavigate({ kind: "branch", id: source.id })
            : undefined
        }
        tabs={
          <PullRequestTabs
            label="Review views"
            tabs={[
              {
                value: "conversation",
                label: "Conversation",
                icon: <MessageSquare />,
                count: threads.length,
              },
              {
                value: "commits",
                label: "Versions",
                icon: <GitCommitHorizontal />,
                count: shownHistory.length,
              },
              {
                value: "checks",
                label: "Actions",
                icon: actionRuns.length ? (
                  <CheckIcon state={checkState} />
                ) : (
                  <IntelligenceMark />
                ),
              },
              { value: "changes", label: "Changes" },
            ]}
          />
        }
      />
      <ErrorMessage message={error} />
      <TabPanel value="checks">
        <ActionChecksPanel
          pullRequest={p}
          sourceHeadId={source?.headId}
          sourceName={sourceName}
          canCommit={Boolean(source?.collaboratorIds.includes(userId))}
        />
      </TabPanel>
      {/* The other views share the merge status and the reviewers. */}
      {tab !== "checks" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-4">
            {/* What blocks the merge comes first, before the conversation. */}
            {p.status !== "merged" ? (
              <MergeBox
                target={targetName}
                verb="apply"
                requirements={rows}
                blocked={blockers.length > 0}
                readySummary="Required reviews approve this exact result. No conflicts or blocking discussions remain."
                before={
                  actionRuns.length > 0 &&
                  !actionGate && (
                    <ActionCheckRow
                      pullRequestId={p.id}
                      sourceHeadId={source?.headId}
                      onDetails={() => setTab("checks")}
                    />
                  )
                }
                note={
                  canMerge ? (
                    <>
                      {blockers.length > 0 && (
                        <span className="block font-medium text-foreground">
                          Resolve the{" "}
                          {blockers.length === 1
                            ? "requirement"
                            : `${blockers.length} requirements`}{" "}
                          above to {breakdown ? "create the items" : "apply it"}
                          .
                        </span>
                      )}
                      {mergeEffect}
                    </>
                  ) : (
                    `You can't ${breakdown ? "create the items" : "apply this change"}. ${isMain(target) ? "It needs permission to edit specifications." : `Only collaborators on ${targetName} can apply it.`}`
                  )
                }
                action={
                  <Button
                    disabled={
                      pending || !canMerge || blockers.length > 0 || !heads
                    }
                    onClick={
                      heads &&
                      (() =>
                        void run({
                          type: "mergePullRequest",
                          workItemId: item.id,
                          pullRequestId: p.id,
                          ...heads,
                        }))
                    }
                  >
                    {breakdown ? (
                      <ListTree className="size-3.5" aria-hidden />
                    ) : (
                      <GitMerge className="size-3.5" aria-hidden />
                    )}
                    {breakdown ? "Create the items" : "Apply change"}
                  </Button>
                }
              >
                {resolving && ours && theirs && source && target && (
                  <ConflictResolver
                    key={`${ours.id}:${theirs.id}`}
                    base={common ?? { title: "", content: "" }}
                    ours={ours}
                    theirs={theirs}
                    pending={pending}
                    action={`Save the resolution to ${sourceName}`}
                    oursLabel={`${sourceName} (this change)`}
                    theirsLabel={targetLabel}
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
              </MergeBox>
            ) : (
              <MergedNotice label="Applied">
                {breakdown ? (
                  <p>
                    Created. The reviewed breakdown is part of the
                    specification&apos;s history, and its items are below the
                    specification.
                  </p>
                ) : (
                  <p>
                    Applied. The reviewed text is part of{" "}
                    {isMain(target)
                      ? "the specification's history"
                      : `${targetName}'s versions`}
                    .
                    {automaticallyDeleted && (
                      <>
                        {" "}
                        Lictory closed the change{" "}
                        <BranchName>{sourceName}</BranchName>.
                      </>
                    )}
                    {source && isMain(target) && !willDeleteSource && (
                      <>
                        {" "}
                        The change is kept because another open review uses it.
                      </>
                    )}
                  </p>
                )}
              </MergedNotice>
            )}
            <TabPanel value="commits">
              <CommitHistory commits={shownHistory} memberName={memberName} />
            </TabPanel>
            <TabPanel value="changes" className="space-y-4">
              {display && before ? (
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
                          setDraft({ section: "Proposed result" });
                          setTab("conversation");
                        }}
                      >
                        <MessageSquare className="size-3.5" />
                        Discuss this change
                      </Button>
                    )}
                  </div>
                  {/* Changed words in context; "Show full text" reads the
                      complete merge result. */}
                  <SpecDiff
                    before={before.content}
                    after={display.content}
                    beforeLabel={targetLabel}
                    afterLabel={
                      p.status === "merged" ? "Applied" : "This change"
                    }
                  />
                  <BreakdownProposal
                    includeApplied
                    created={p.status === "merged"}
                    proposals={pendingEntries(
                      display.proposedChildren,
                      before.proposedChildren,
                    )}
                  />
                </>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  The result is unavailable until the conflicts are resolved.
                </p>
              )}
            </TabPanel>
            <TabPanel value="conversation" className="space-y-4">
              <article className="overflow-hidden rounded-lg border">
                <p className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                  <Actor userId={p.authorId} label="none" size={20} />
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
                  created={p.status === "merged"}
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
            </TabPanel>
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
                        specificationPullRequest.allows(p.status, "review") &&
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
                      {/* Approving here approves the whole merged text,
                          which main keeps as this discipline's approval of
                          the new revision: say so before the click. */}
                      {assigned &&
                        !readOnly &&
                        specificationPullRequest.allows(p.status, "review") &&
                        heads &&
                        !contributed &&
                        !r.decision &&
                        isMain(target) && (
                          <p className="pl-6 text-xs text-muted-foreground">
                            Approving approves the whole specification as it
                            reads once this change applies, not only the change:
                            it becomes {role?.name ?? "this discipline"}&apos;s
                            approval of revision {item.revisionNumber + 1}.
                          </p>
                        )}
                      {assigned &&
                        !readOnly &&
                        specificationPullRequest.allows(p.status, "review") &&
                        heads &&
                        contributed &&
                        !r.decision && (
                          <p className="pl-6 text-xs text-muted-foreground">
                            You contributed to this change, so another{" "}
                            {role?.name ?? "reviewing"} member approves it.
                          </p>
                        )}
                    </li>
                  );
                })}
              </ul>
              {manage &&
                capabilities.requestReviews &&
                specificationPullRequest.allows(p.status, "requestReview") &&
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
                <p className="text-xs text-muted-foreground">
                  Approvals apply to the exact result, the whole specification
                  once this change applies
                  {isMain(target)
                    ? `; applying records them as approvals of revision ${item.revisionNumber + 1}`
                    : ""}
                  . A new version on either side asks reviewers again.
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
                  No Lictory Actions have run on this review.
                </button>
              )}
            </section>
            <section className="space-y-2 border-t pt-4">
              {manage &&
                specificationPullRequest.allows(p.status, "markDraft") && (
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
                  <DeletePrompt
                    name={`review “${p.title}”`}
                    detail={
                      p.status === "merged"
                        ? "The applied text stays in the specification."
                        : "The change is kept."
                    }
                    onDelete={() =>
                      run(
                        {
                          type: "deletePullRequest",
                          workItemId: item.id,
                          pullRequestId: p.id,
                        },
                        () => onNavigate({ kind: "branches" }),
                      )
                    }
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        Delete review
                      </Button>
                    }
                  />
                )}
            </section>
          </aside>
        </div>
      )}
    </TabsRoot>
  );
}
