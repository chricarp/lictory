import { useId, type ReactNode } from "react";
import { GitMerge } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import {
  CheckIcon,
  type CheckState,
} from "@lictory/platform/components/review/flow-ui";

// Whether a pull request can merge, and the merge itself, the same for code
// and specification pull requests: a heading that says ready or blocked,
// one row per requirement (each unmet one says why, in words), then what
// merging will do, or why this person cannot merge, beside the merge
// button. Nothing is mergeable from a summary alone: the requirements are
// always listed.

export type MergeRequirement = {
  key: string;
  // success: met; failure: blocks the merge; pending / running: not yet
  // known; neutral / skipped: informative only.
  state: CheckState;
  // What it requires, or why it is not met ("Checks are failing.").
  text: ReactNode;
  // One quieter line: which checks, who approved.
  detail?: ReactNode;
  // A small control for this requirement ("Ready for review", "Resolve").
  action?: ReactNode;
};

const unmet = (r: MergeRequirement) =>
  r.state === "failure" || r.state === "pending" || r.state === "running";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function MergeBox({
  target,
  verb = "merge",
  requirements,
  blocked,
  readySummary,
  note,
  noteId,
  action,
  before,
  children,
  headingLevel = 2,
  className,
}: {
  // The branch it merges into, for "2 requirements into main not met yet".
  target: string;
  // The act in the subject's words: code and pages merge into a branch; a
  // specification's proposed change applies to the specification.
  verb?: "merge" | "apply";
  requirements: readonly MergeRequirement[];
  // Override when something outside the rows blocks the merge (a draft).
  // Defaults to any requirement failing, pending or running.
  blocked?: boolean;
  // Said under "Ready to merge".
  readySummary?: ReactNode;
  // Beside the merge button: what merging does, or why this person cannot
  // merge ("Merging here needs …"). Always say one of them.
  note?: ReactNode;
  // The note's id, so a disabled merge button can be described by it.
  noteId?: string;
  // The merge button, with its method or confirmation.
  action?: ReactNode;
  // A row above the requirements (a summary of running checks).
  before?: ReactNode;
  // Between the requirements and the footer (a conflict resolver, a
  // confirmation).
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const id = useId();
  const missing = requirements.filter(unmet).length;
  const isBlocked = blocked ?? missing > 0;
  // Nothing fails, something has yet to report (checks running, a review
  // to come): normal progress, said as waiting, not as a block.
  const waiting =
    isBlocked &&
    missing > 0 &&
    !requirements.some((r) => r.state === "failure");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const words =
    verb === "apply"
      ? {
          blocked: waiting ? "Waiting to apply" : "Applying is blocked",
          ready: "Ready to apply",
          to: "apply",
        }
      : {
          blocked: waiting ? "Waiting to merge" : "Merging is blocked",
          ready: "Ready to merge",
          to: `merge into ${target}`,
        };
  return (
    <section
      aria-labelledby={id}
      data-merge-box={isBlocked ? (waiting ? "waiting" : "blocked") : "ready"}
      className={cn(
        "overflow-hidden rounded-xl bg-card shadow-(--shadow-border)",
        !isBlocked && "ring-1 ring-success/40",
        className,
      )}
    >
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            !isBlocked
              ? "bg-success text-white"
              : waiting
                ? "bg-muted text-muted-foreground"
                : "bg-warning/12 text-warning",
          )}
        >
          <GitMerge className="size-4" />
        </span>
        <div className="min-w-0">
          <Heading id={id} className="text-sm leading-5 font-semibold">
            {isBlocked ? words.blocked : words.ready}
          </Heading>
          <p className="text-xs text-muted-foreground">
            {isBlocked
              ? missing > 0
                ? `${plural(missing, "requirement")} to ${words.to} not met yet.`
                : `Not every requirement to ${words.to} is met yet.`
              : (readySummary ?? `Every requirement to ${words.to} is met.`)}
          </p>
        </div>
      </div>
      {before && <div className="border-b px-4 py-2.5">{before}</div>}
      {requirements.length > 0 && (
        <ul
          aria-label={verb === "apply" ? "Requirements" : "Merge requirements"}
          className="divide-y divide-border/70"
        >
          {requirements.map((r) => (
            <li
              key={r.key}
              data-requirement={r.state}
              className="flex items-start gap-2.5 px-4 py-2.5 text-[13px] leading-5"
            >
              <CheckIcon state={r.state} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p>{r.text}</p>
                {r.detail && (
                  <div className="text-xs text-muted-foreground">
                    {r.detail}
                  </div>
                )}
              </div>
              {r.action}
            </li>
          ))}
        </ul>
      )}
      {children && <div className="border-t p-4">{children}</div>}
      {(note ?? action) && (
        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-4 py-3">
          <p
            id={noteId}
            className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground"
          >
            {note}
          </p>
          {action && (
            <div className="flex flex-wrap items-center gap-1.5">{action}</div>
          )}
        </div>
      )}
    </section>
  );
}

// A merged pull request: what happened to the change.
export function MergedNotice({
  children,
  label = "Merged",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-(--shadow-border)"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-merged text-white dark:text-background">
        <GitMerge aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 text-[13px] leading-5">{children}</div>
    </section>
  );
}
