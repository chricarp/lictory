import type { ReactNode } from "react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { Actor } from "@lictory/platform/components/identity/actor";
import { ItemScreenTitle } from "@lictory/platform/components/items/screen-title";
import {
  CheckIcon,
  type CheckState,
} from "@lictory/platform/components/review/flow-ui";

// A specification's pull request reads like a code pull request: the same
// header (title, state, "Ada wants to merge 1 commit into main from
// breakdown", then the views) and the same merge box (what is required, the
// merge button, why it is refused). These take plain values so the shared
// code-host components can stand in for them without touching the
// specification's rules (`branch-workspace.tsx` computes the requirements).

export type PullRequestState = "draft" | "open" | "merged" | "closed";

const stateMeta: Record<
  PullRequestState,
  { label: string; tone: StatusTone; icon: ReactNode }
> = {
  draft: { label: "Draft", tone: "neutral", icon: <GitPullRequestDraft /> },
  open: { label: "Open", tone: "info", icon: <GitPullRequest /> },
  merged: { label: "Merged", tone: "success", icon: <GitMerge /> },
  closed: { label: "Closed", tone: "neutral", icon: <GitPullRequestClosed /> },
};

export function PullRequestStateChip({ state }: { state: PullRequestState }) {
  const meta = stateMeta[state];
  return (
    <StatusChip tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusChip>
  );
}

// A branch name, in mono: an identifier.
export function BranchName({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">
      {children}
    </code>
  );
}

export function SpecPullRequestHeader({
  title,
  state,
  authorId,
  commits,
  target,
  source,
  tabs,
}: {
  title: string;
  state: PullRequestState;
  authorId: string;
  commits: number;
  // The branches, drawn by the caller (they may link).
  target: ReactNode;
  source: ReactNode;
  // The views below the header.
  tabs?: ReactNode;
}) {
  return (
    <header data-pull-request-header className="space-y-2">
      <ItemScreenTitle>{title}</ItemScreenTitle>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
        <PullRequestStateChip state={state} />
        <Actor
          userId={authorId}
          size={20}
          className="font-medium text-foreground"
        />
        <span>
          {state === "merged" ? "merged" : "wants to merge"} {commits}{" "}
          {commits === 1 ? "commit" : "commits"} into
        </span>
        {target}
        <span>from</span>
        {source}
      </p>
      {tabs}
    </header>
  );
}

export type MergeRequirement = {
  key: string;
  state: CheckState;
  text: string;
  detail?: ReactNode;
  action?: ReactNode;
};

// What must be true to merge, one row per requirement, the merge button and,
// when it is refused, why: in the box itself, never only a disabled button.
export function SpecMergeBox({
  requirements,
  blockers,
  targetName,
  status,
  effect,
  refusal,
  merging,
  onMerge,
  children,
}: {
  requirements: MergeRequirement[];
  // How many requirements are not met.
  blockers: number;
  targetName: string;
  // Extra rows above the requirements (a check run's summary).
  status?: ReactNode;
  // What merging does, said before the person merges.
  effect: ReactNode;
  // Why this person cannot merge at all, whatever the requirements say.
  refusal?: string;
  merging: boolean;
  // Absent while the branch heads are unknown.
  onMerge?: () => void;
  // Shown under the requirements (the conflict resolver).
  children?: ReactNode;
}) {
  const ready = blockers === 0;
  return (
    <section
      aria-label="Merge status"
      data-merge-box
      className={cn(
        "overflow-hidden rounded-xl bg-card shadow-(--shadow-border)",
        ready && !refusal && "ring-1 ring-success/40",
      )}
    >
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            ready ? "bg-success text-white" : "bg-muted text-muted-foreground",
          )}
        >
          <GitMerge aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {ready ? "Ready to merge" : "Merging is blocked"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {ready
              ? "Required reviews approve this merge result. No conflicts or blocking discussions remain."
              : `${blockers} ${blockers === 1 ? "requirement" : "requirements"} into ${targetName} not met yet.`}
          </p>
        </div>
      </div>
      {status}
      <ul className="divide-y">
        {requirements.map((r) => (
          <li
            key={r.key}
            className="flex items-start gap-2.5 px-4 py-2.5 text-[13px]"
          >
            <CheckIcon state={r.state} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p>{r.text}</p>
              {r.detail && (
                <p className="text-xs text-muted-foreground">{r.detail}</p>
              )}
            </div>
            {r.action}
          </li>
        ))}
      </ul>
      {children}
      <div className="flex items-center gap-3 border-t bg-muted/20 px-4 py-3 max-sm:flex-col max-sm:items-stretch">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {refusal ? (
            <p>{refusal}</p>
          ) : (
            <>
              {!ready && (
                <p className="font-medium text-foreground">
                  Resolve the{" "}
                  {blockers === 1 ? "requirement" : `${blockers} requirements`}{" "}
                  above to merge.
                </p>
              )}
              <p>{effect}</p>
            </>
          )}
        </div>
        <Button
          disabled={merging || Boolean(refusal) || !ready || !onMerge}
          onClick={onMerge}
        >
          <GitMerge className="size-3.5" />
          Merge pull request
        </Button>
      </div>
    </section>
  );
}
