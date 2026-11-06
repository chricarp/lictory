import { useId, useState } from "react";
import { GitBranch, MessageSquare, Pencil, ShieldCheck } from "lucide-react";
import {
  finalizeBranchName,
  sanitizeBranchNameInput,
  branchNameProblem,
} from "@lictory/core/lib/branch-name";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import type { PageBranch, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
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
  if (!line.isMain || !line.writable) return null;
  const unpublished = line.draft?.uncommittedChanges;
  return (
    <Button size="sm" variant="secondary" onClick={onEdit}>
      <Pencil className="size-3.5" aria-hidden />
      {unpublished ? "Continue editing" : "Edit"}
    </Button>
  );
}

export function CommentsToggle({
  page,
  open,
  onToggle,
}: {
  page: SpacePage;
  open: boolean;
  onToggle: () => void;
}) {
  const label = `Comments: ${page.openThreads} open${page.blockingThreads ? `, ${page.blockingThreads} blocking` : ""}`;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="inline-flex h-6 items-center gap-1 rounded-full px-2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <MessageSquare className="size-3.5" aria-hidden />
      <span className="tabular-nums">{page.openThreads}</span>
      {page.blockingThreads > 0 && (
        <span className="rounded-full bg-destructive/8 px-1.5 text-destructive tabular-nums ring-1 ring-destructive/20 ring-inset">
          {page.blockingThreads} blocking
        </span>
      )}
    </button>
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
