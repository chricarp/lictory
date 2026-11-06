import { useId, useState } from "react";
import { GitBranch, MessageSquare, Pencil, ShieldCheck } from "lucide-react";
import {
  finalizeBranchName,
  sanitizeBranchNameInput,
  branchNameProblem,
} from "@lictory/core/lib/branch-name";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { Tooltip } from "@lictory/ui/tooltip";
import type {
  PageBranch,
  Space,
  SpacePage,
} from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { blockingSummary } from "@lictory/platform/components/spaces/space-meta";
import { touchTarget } from "@lictory/platform/components/spaces/touch";
import {
  useSelectLine,
  type PageLine,
} from "@lictory/platform/components/spaces/editor/line";

// Page header controls that do not need the editor bundle: Edit (main in
// a Direct space), Start a branch (main in a Reviewed space) and the
// comments toggle with the page's open and blocking counts.

export function EditButton({
  line,
  onEdit,
}: {
  line: PageLine;
  onEdit: () => void;
}) {
  const noteId = useId();
  if (!line.isMain || !line.writable) return null;
  // The live draft's state is part of the action: "Continue editing" with
  // the draft's dot when it holds unpublished changes.
  const unpublished = line.draft?.uncommittedChanges;
  return (
    <Button
      size="sm"
      onClick={onEdit}
      aria-describedby={unpublished ? noteId : undefined}
      title={
        unpublished
          ? "The live draft has changes that are not published yet."
          : undefined
      }
      className={cn(touchTarget, "max-sm:px-3.5 touch:px-3.5")}
    >
      <Pencil className="size-3.5" aria-hidden />
      {unpublished ? "Continue editing" : "Edit"}
      {unpublished && (
        <>
          <span
            aria-hidden
            className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-brand ring-2 ring-brand/25"
          />
          <span id={noteId} hidden>
            Unpublished draft
          </span>
        </>
      )}
    </Button>
  );
}

// The open discussions, counted neutrally; a blocking one adds a small
// marker whose words (tooltip and accessible name) say what it holds back.
// Strong red belongs to the merge workflow, where blocking stops something.
export function CommentsToggle({
  space,
  page,
  open,
  onToggle,
}: {
  space: Pick<Space, "publishing">;
  page: SpacePage;
  open: boolean;
  onToggle: () => void;
}) {
  const count = page.openThreads;
  const discussions = count === 1 ? "1 discussion" : `${count} discussions`;
  const blocking = page.blockingThreads
    ? blockingSummary(space, page.blockingThreads)
    : null;
  const label = `Comments: ${discussions}${blocking ? `, ${blocking}` : ""}`;
  return (
    <Tooltip label={blocking ? `${discussions} · ${blocking}` : discussions}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-medium transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:active:scale-[0.96] max-sm:px-3 touch:px-3",
          touchTarget,
          open
            ? "bg-foreground/8 text-foreground"
            : "bg-card text-foreground/80 shadow-(--shadow-border) hover:bg-muted hover:text-foreground",
        )}
      >
        <MessageSquare className="size-3.5" aria-hidden />
        <span className="tabular-nums">
          {count === 0 ? "Comments" : discussions}
        </span>
        {page.blockingThreads > 0 && (
          <span
            aria-hidden
            className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-destructive/80 ring-2 ring-destructive/12"
          />
        )}
      </button>
    </Tooltip>
  );
}

// Main of a Reviewed space is protected: changes start on a branch.
export function ReviewedNotice({
  line,
  page,
  branches,
}: {
  line: PageLine;
  page: SpacePage;
  branches: readonly PageBranch[];
}) {
  if (!line.isMain || !line.reviewed || !line.canEditSpace) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3 text-[13px] ring-1 ring-foreground/8 ring-inset">
      <ShieldCheck
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <p className="min-w-0 flex-1 basis-56">
        Changes to this page are reviewed. Start a branch to propose changes.
      </p>
      <StartBranch page={page} branches={branches} />
    </div>
  );
}

function suggestedName(base: string, taken: ReadonlySet<string>) {
  const root = finalizeBranchName(sanitizeBranchNameInput(base)) || "changes";
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; ; n += 1) {
    const name = `${root}-${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export function StartBranch({
  page,
  branches,
}: {
  page: SpacePage;
  branches: readonly PageBranch[];
}) {
  const { userId, directory } = useWorkspace();
  const me = directory.members.find((m) => m.id === userId);
  const taken = new Set(branches.map((b) => b.name.toLowerCase()));
  const base = `${me?.handle ?? me?.name.split(" ")[0] ?? "my"}/${page.title}`;
  return (
    <Popover
      width={320}
      align="end"
      trigger={(props) => (
        <Button {...props} size="sm" variant="secondary">
          <GitBranch className="size-3.5" aria-hidden /> Start a branch
        </Button>
      )}
    >
      {(close) => (
        <StartBranchForm
          pageId={page.id}
          initial={suggestedName(base.slice(0, 60), taken)}
          taken={taken}
          onDone={close}
        />
      )}
    </Popover>
  );
}

function StartBranchForm({
  pageId,
  initial,
  taken,
  onDone,
}: {
  pageId: string;
  initial: string;
  taken: ReadonlySet<string>;
  onDone: () => void;
}) {
  const labelId = usePopover()?.labelId;
  const { mutateConfirmed } = useWorkspace();
  const selectLine = useSelectLine();
  const inputId = useId();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    const final = finalizeBranchName(name);
    const problem =
      branchNameProblem(final) ??
      (taken.has(final.toLowerCase())
        ? "That branch name is already in use on this page."
        : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    const branchId = crypto.randomUUID();
    try {
      await mutateConfirmed({
        type: "createPageBranch",
        pageId,
        branchId,
        name: final,
      });
      onDone();
      selectLine(branchId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The branch was not created.");
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit();
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        Start a branch
      </h2>
      <p className="text-xs text-muted-foreground">
        A branch has its own live draft. Propose it for review when it is ready.
      </p>
      <label htmlFor={inputId} className="text-xs font-medium">
        Branch name
      </label>
      <input
        id={inputId}
        autoFocus
        value={name}
        onChange={(e) => setName(sanitizeBranchNameInput(e.target.value))}
        className="h-8 w-full rounded-md border bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Starting…" : "Start branch"}
        </Button>
      </div>
    </form>
  );
}
