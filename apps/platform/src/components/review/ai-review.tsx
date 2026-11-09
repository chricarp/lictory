import { Link } from "@lictory/platform/lib/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  Check,
  CircleHelp,
  GitPullRequest,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  byType,
  identifier,
  relativeTime,
  typeOf,
} from "@lictory/core/lib/work-items";
import {
  aiScoreBand,
  INTELLIGENCE_REVIEW_ACTION,
  type AiFinding,
  type AiSeverity,
} from "@lictory/core/contracts/ai";
import type { Command, EntityOf } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Badge, SectionLabel } from "@lictory/ui/primitives";
import { StateIllustration } from "@lictory/ui/state-illustration";
import { RevisionDiff } from "@lictory/ui/diff";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useItem } from "@lictory/platform/components/items/item-context";
import {
  CheckIcon,
  duration,
  type CheckState,
} from "@lictory/platform/components/review/flow-ui";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  ContextCitations,
  GroundedIn,
} from "@lictory/platform/components/intelligence/citations";

type Run = EntityOf<"aiRun">;

export function useAiRuns(kind: Run["kind"], pullRequestId?: string) {
  const { entities } = useItem();
  return useMemo(
    () =>
      byType(entities, "aiRun")
        .filter(
          (r) =>
            r.kind === kind &&
            (!pullRequestId || r.pullRequestId === pullRequestId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [entities, kind, pullRequestId],
  );
}

function useCommand() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (
    send: (c: Command) => Promise<unknown>,
    c: Command,
  ): Promise<boolean> => {
    setPending(true);
    setError("");
    try {
      await send(c);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request failed.");
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error };
}

// Why Lictory Intelligence cannot be used right now, in words the user can act
// on.
export function useAiBlocker() {
  const { directory, isAdmin } = useWorkspace();
  if (!directory.ai.available)
    return "Lictory Intelligence is not configured on this server.";
  if (!directory.ai.enabled)
    return isAdmin
      ? "Lictory Intelligence is off for this organization. Turn it on in Settings → Lictory Intelligence."
      : "Lictory Intelligence is off for this organization. Ask an administrator to turn it on.";
  return undefined;
}

const bandTone = {
  good: "text-success",
  fair: "text-warning",
  poor: "text-destructive",
} as const;
const bandStroke = {
  good: "stroke-success",
  fair: "stroke-warning",
  poor: "stroke-destructive",
} as const;

export function ScoreRing({
  score,
  size = 44,
  className,
}: {
  score: number;
  size?: number;
  className?: string;
}) {
  const band = aiScoreBand(score);
  const r = 15.5;
  const circumference = 2 * Math.PI * r;
  return (
    <div
      role="img"
      aria-label={`Lictory Intelligence readiness score ${score} out of 100`}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="2.5"
          className="stroke-foreground/8"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          className={cn(
            bandStroke[band],
            "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500",
          )}
        />
      </svg>
      <span
        className={cn(
          "font-semibold tabular-nums",
          bandTone[band],
          size >= 64 ? "text-lg" : "text-[13px]",
        )}
      >
        {score}
      </span>
    </div>
  );
}

export const severityMeta: Record<
  AiSeverity,
  { label: string; tone: "danger" | "warning" | "info" | "neutral" }
> = {
  blocker: { label: "Blocker", tone: "danger" },
  major: { label: "Major", tone: "warning" },
  minor: { label: "Minor", tone: "info" },
  info: { label: "Note", tone: "neutral" },
};
const kindMeta = {
  validation: { label: "Validation", icon: ShieldAlert },
  suggestion: { label: "Suggestion", icon: Lightbulb },
  question: { label: "Question", icon: CircleHelp },
} as const;
const severityOrder: AiSeverity[] = ["blocker", "major", "minor", "info"];
export const counts = (findings: AiFinding[]) =>
  severityOrder
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0);

// The full review: the score explained by its findings, grouped by item, with
// a deliberate path from fixable findings to corrective pull requests.
export function AiReviewView({
  runId,
  onClose,
  onOpenRun,
}: {
  runId: string;
  onClose: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const ctx = useItem();
  const workspace = useWorkspace();
  const runs = useAiRuns("item_review");
  const run = runs.find((r) => r.id === runId);
  const blocker = useAiBlocker();
  const request = useCommand();
  const [filter, setFilter] = useState<AiFinding["kind"] | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [outcomes, setOutcomes] = useState<
    { workItemId: string; ok: boolean; message?: string }[]
  >([]);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  if (!run)
    return (
      <div className="space-y-3">
        <BackButton onClose={onClose} />
        <p className="text-sm text-muted-foreground">
          This Lictory Intelligence review is unavailable.
        </p>
      </div>
    );
  const itemOf = (id: string) => workspace.items.find((i) => i.id === id);
  const keyOf = (id: string) => {
    const i = itemOf(id);
    return i ? identifier(ctx.project, i.number) : "Item";
  };
  const hrefOf = (id: string, pr?: string) => {
    const i = itemOf(id);
    if (!i) return undefined;
    const href = paths.item(
      workspace.organization.slug,
      ctx.project.key,
      identifier(ctx.project, i.number),
    );
    return pr ? `${href}?pr=${pr}` : href;
  };
  const visible = run.findings.filter(
    (f) => filter === "all" || f.kind === filter,
  );
  const order = [
    ctx.item.id,
    ...Object.keys(run.contextRevisions).filter((id) => id !== ctx.item.id),
  ];
  const groups = order
    .map((id) => ({ id, findings: visible.filter((f) => f.workItemId === id) }))
    .filter((g) => g.findings.length);
  const fixable = (f: AiFinding) =>
    Boolean(f.edit) &&
    !run.staleAt &&
    !run.correctivePullRequests[f.workItemId] &&
    !ctx.readOnly;
  const chosen = run.findings.filter((f) => selected.has(f.id) && fixable(f));
  const chosenItems = [...new Set(chosen.map((f) => f.workItemId))];
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // One pull request per affected item. Partial success is reported per item;
  // successful ones are recorded on the run and cannot be duplicated.
  const createPullRequests = async () => {
    setCreating(true);
    const results: typeof outcomes = [];
    for (const workItemId of chosenItems) {
      const command: Command = {
        type: "createAiCorrectivePr",
        workItemId,
        runId: run.id,
        findingIds: chosen
          .filter((f) => f.workItemId === workItemId)
          .map((f) => f.id),
        branchId: crypto.randomUUID(),
        pullRequestId: crypto.randomUUID(),
      };
      try {
        await (workItemId === ctx.item.id
          ? ctx.mutateConfirmed(command)
          : workspace.mutateConfirmed(command));
        results.push({ workItemId, ok: true });
      } catch (e) {
        results.push({
          workItemId,
          ok: false,
          message: e instanceof Error ? e.message : "Not created.",
        });
      }
    }
    setOutcomes(results);
    setSelected(new Set());
    setCreating(false);
  };
  const ask = async (f: AiFinding) => {
    const target = itemOf(f.workItemId);
    if (!target?.revisionId || !f.question) return;
    const command: Command = {
      type: "createThread",
      workItemId: f.workItemId,
      baseRevisionId: target.revisionId,
      threadId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      body: `${f.question}\n\n_Raised by a Lictory Intelligence review: ${f.title}_`,
      blocking: false,
      section: f.edit?.section ?? "Lictory Intelligence review",
      ...(f.evidence[0] ? { quote: f.evidence[0].slice(0, 2000) } : {}),
    };
    try {
      await (f.workItemId === ctx.item.id
        ? ctx.mutateConfirmed(command)
        : workspace.mutateConfirmed(command));
      setAsked((a) => new Set(a).add(f.id));
    } catch {
      // The thread composer remains available on the item itself.
    }
  };
  const kinds = (["validation", "suggestion", "question"] as const).map(
    (k) => [k, run.findings.filter((f) => f.kind === k).length] as const,
  );
  const history = runs.filter((r) => r.status === "completed");
  const assessed = ctx.revisions.find(
    (r) => r.id === run.contextRevisions[ctx.item.id],
  )?.number;
  return (
    <div className="space-y-6 pb-24">
      <BackButton onClose={onClose} />
      {/* The review is evidence, not a decision: it reads as a proposal in a
          tray, with its provenance named before its verdict. */}
      <header className="rounded-[1.375rem] bg-tray p-1 ring-1 ring-border/70 ring-inset">
        <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2 pb-2.5 font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          <IntelligenceMark className="size-3.5 text-foreground" />
          Lictory Intelligence · review
          <span className="ml-auto inline-flex h-5 items-center rounded-full bg-card px-2 tracking-[0.04em] ring-1 ring-foreground/8 ring-inset">
            Proposal · people decide
          </span>
        </div>
        <div className="rounded-[1.125rem] bg-card p-4 shadow-(--shadow-border)">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              {/* The headline is what needs a human, not a grade. */}
              <h1 className="text-xl font-semibold tracking-[-0.02em]">
                {run.findings.length === 0
                  ? "No proposed concerns"
                  : `${run.findings.length} proposed concern${run.findings.length === 1 ? "" : "s"}`}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                AI assessment of {identifier(ctx.project, ctx.item.number)} ·
                requested by {ctx.memberName(run.requestedById)} ·{" "}
                {relativeTime(run.completedAt ?? run.createdAt)}
              </p>
            </div>
          </div>
          {run.summary && <Summary text={run.summary} />}
          {/* Provenance: which revision was read, whether it is still
              current, how much context, which model. */}
          <ul className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t pt-3 text-[11.5px]">
            {assessed != null && (
              <li className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 font-mono text-[11px] ring-1 ring-foreground/8 ring-inset">
                Read revision {assessed}
              </li>
            )}
            <li
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-medium ring-1 ring-inset",
                run.staleAt
                  ? "bg-warning/8 text-warning ring-warning/25"
                  : "bg-success/8 text-success ring-success/20",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  run.staleAt ? "bg-warning" : "bg-success",
                )}
              />
              {run.staleAt ? "Outdated" : "Current"}
            </li>
            <li
              title={run.model ? `Model: ${run.model}` : undefined}
              className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 ring-1 ring-foreground/8 ring-inset"
            >
              {Object.keys(run.contextRevisions).length} item
              {Object.keys(run.contextRevisions).length === 1 ? "" : "s"} read
            </li>
            {run.score != null && (
              // The model's reading of the text, not a readiness verdict:
              // neutral, and named for what it is.
              <li
                title="How complete and unambiguous the model finds the text. Readiness checks and people decide readiness."
                className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 ring-1 ring-foreground/8 ring-inset"
              >
                AI text assessment{" "}
                <span className="font-mono text-[11px] tabular-nums">
                  {run.score}/100
                </span>
              </li>
            )}
          </ul>
        </div>
      </header>
      <GroundedIn context={run.intelligenceContext} />
      {run.staleAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[13px]">
          <AlertTriangle className="size-4 text-amber-600" />
          <span className="min-w-0 flex-1">
            Outdated: {run.staleReason}. Findings may no longer apply, and
            corrective pull requests are disabled.
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={request.pending || Boolean(blocker) || ctx.readOnly}
            title={blocker}
            onClick={() =>
              void request.run(ctx.mutateConfirmed, {
                type: "requestAiReview",
                workItemId: ctx.item.id,
                runId: crypto.randomUUID(),
              })
            }
          >
            <RotateCcw className="size-3.5" /> Run a new review
          </Button>
        </div>
      )}
      {request.error && (
        <p role="alert" className="text-sm text-destructive">
          {request.error}
        </p>
      )}
      {run.strengths.length > 0 && (
        // Reassurance on demand; the concerns come first.
        <details className="group/works">
          <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase select-none hover:text-foreground">
            <ChevronRight
              aria-hidden
              className="size-3 transition-transform group-open/works:rotate-90"
            />
            What works · {run.strengths.length}
          </summary>
          <ul className="mt-2 space-y-1 text-[13px]">
            {run.strengths.map((s) => (
              <li key={s} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
      <nav aria-label="Filter findings" className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", run.findings.length] as const,
            // Only the kinds this review found.
            ...kinds.filter(([, n]) => n > 0),
          ] as const
        ).map(([k, n]) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "secondary" : "ghost"}
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "All" : kindMeta[k].label + "s"}
            <span className="text-muted-foreground tabular-nums">{n}</span>
          </Button>
        ))}
      </nav>
      {groups.length === 0 && (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {run.findings.length
            ? "No findings of this kind."
            : "No gaps found. Human review still decides readiness."}
        </p>
      )}
      {groups.map((g) => {
        const target = itemOf(g.id);
        const pr = run.correctivePullRequests[g.id];
        return (
          <section key={g.id} className="space-y-2">
            <div className="flex items-center gap-2 text-[13px]">
              {target && <TypeIcon type={typeOf(workspace.delivery, target)} />}
              <Link
                href={hrefOf(g.id) ?? "#"}
                className="font-medium hover:underline"
              >
                {keyOf(g.id)}
              </Link>
              <span className="min-w-0 truncate text-muted-foreground">
                {target?.title}
              </span>
              {pr && (
                <Link
                  href={hrefOf(g.id, pr) ?? "#"}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                >
                  <GitPullRequest className="size-3.5" /> Corrective pull
                  request
                </Link>
              )}
            </div>
            {g.findings.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                selectable={fixable(f)}
                selected={selected.has(f.id)}
                onToggle={() => toggle(f.id)}
                action={
                  f.question && !run.staleAt && !ctx.readOnly ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={asked.has(f.id)}
                      onClick={() => void ask(f)}
                    >
                      {asked.has(f.id) ? (
                        <>
                          <Check className="size-3.5" /> Asked
                        </>
                      ) : (
                        <>
                          <MessageSquarePlus className="size-3.5" /> Ask the
                          team
                        </>
                      )}
                    </Button>
                  ) : null
                }
              />
            ))}
          </section>
        );
      })}
      {outcomes.length > 0 && (
        <ul className="space-y-1 rounded-lg border p-3 text-[13px]">
          {outcomes.map((o) => (
            <li key={o.workItemId} className="flex gap-2">
              {o.ok ? (
                <Check className="mt-0.5 size-3.5 text-success" />
              ) : (
                <XCircle className="mt-0.5 size-3.5 text-destructive" />
              )}
              <span>
                <b>{keyOf(o.workItemId)}</b>:{" "}
                {o.ok ? "pull request opened." : o.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {history.length > 1 && (
        <section>
          <SectionLabel className="mb-1.5">Earlier reviews</SectionLabel>
          <ul className="space-y-1">
            {history
              .filter((h) => h.id !== run.id)
              .slice(0, 5)
              .map((h) => (
                <li key={h.id}>
                  <button
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-muted"
                    onClick={() => onOpenRun(h.id)}
                  >
                    <ScoreRing score={h.score ?? 0} size={28} />
                    {h.findings.length} findings ·{" "}
                    {relativeTime(h.completedAt ?? h.createdAt)}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <p className="min-w-0 flex-1 text-[13px]">
            <b>{chosen.length}</b> {chosen.length === 1 ? "change" : "changes"}{" "}
            selected in {chosenItems.map(keyOf).join(", ")}. Lictory
            Intelligence opens one pull request per item; reviewers decide what
            merges.
          </p>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button disabled={creating} onClick={() => void createPullRequests()}>
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="size-3.5" />
            )}
            Open corrective{" "}
            {chosenItems.length === 1 ? "pull request" : "pull requests"}
          </Button>
        </div>
      )}
    </div>
  );
}

function BackButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClose}>
      <ArrowLeft className="size-3.5" /> Back to specification
    </Button>
  );
}

export function FindingCard({
  finding: f,
  selectable,
  selected,
  onToggle,
  action,
  compact,
}: {
  finding: AiFinding;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  const Kind = kindMeta[f.kind].icon;
  return (
    <article
      className={cn(
        "rounded-2xl bg-card p-4 shadow-(--shadow-border) transition-shadow duration-100",
        selected && "shadow-[0_0_0_1.5px_var(--color-foreground)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Include “${f.title}” in a corrective pull request`}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
        )}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity is the model's proposal; only people and readiness
                checks block. */}
            <Badge tone={severityMeta[f.severity].tone}>
              Proposed {severityMeta[f.severity].label.toLowerCase()}
            </Badge>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
              <Kind className="size-3.5" /> {kindMeta[f.kind].label} ·{" "}
              {f.category.replaceAll("_", " ")}
            </span>
          </div>
          <p className="text-[15px] leading-snug font-semibold tracking-[-0.01em]">
            {f.title}
          </p>
          {!compact && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {f.detail}
            </p>
          )}
          {f.question && <FindingRow label="Question">{f.question}</FindingRow>}
          {!compact && f.recommendation && (
            <FindingRow label="Proposed">{f.recommendation}</FindingRow>
          )}
          {!compact && f.evidence.length > 0 && (
            // What the finding is grounded in, on demand: quoted text from
            // the item.
            <details className="group/evidence rounded-xl bg-muted/70 px-3 py-2">
              <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase select-none hover:text-foreground">
                <ChevronRight
                  aria-hidden
                  className="size-3 transition-transform group-open/evidence:rotate-90"
                />
                Evidence · {f.evidence.length} quote
                {f.evidence.length === 1 ? "" : "s"} from the item
              </summary>
              <div className="mt-2 space-y-1.5">
                {f.evidence.map((e) => (
                  <blockquote
                    key={e}
                    className="border-l-2 border-foreground/15 pl-2.5 text-[13px] leading-relaxed text-foreground/80"
                  >
                    {e}
                  </blockquote>
                ))}
              </div>
            </details>
          )}
          {!compact && f.readings && <Readings readings={f.readings} />}
          <ContextCitations context={f.context} />
          {f.edit && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Proposed change under “{f.edit.section}”
              </p>
              <RevisionDiff
                before={f.edit.find}
                after={f.edit.replace}
                context={0}
              />
            </div>
          )}
          {action && <div className="flex justify-end">{action}</div>}
        </div>
      </div>
    </article>
  );
}

// Both readings of an acceptance criterion, so people judge a divergence
// themselves. One model wrote both: it signals ambiguity, not a disagreement.
function Readings({
  readings,
}: {
  readings: NonNullable<AiFinding["readings"]>;
}) {
  return (
    <details className="group/readings rounded-xl bg-muted/70 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase select-none hover:text-foreground">
        <ChevronRight
          aria-hidden
          className="size-3 transition-transform group-open/readings:rotate-90"
        />
        Two readings of the criterion
      </summary>
      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-foreground/80">
        <blockquote className="border-l-2 border-foreground/15 pl-2.5">
          {readings.criterion}
        </blockquote>
        <div>
          <p className="font-medium text-foreground">QA would test</p>
          <ul className="list-disc pl-5">
            {readings.qa.map((c, i) => (
              <li key={i}>
                {c.situation} → {c.expected}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-foreground">
            An implementer would build
          </p>
          <p>{readings.implementer.builds}</p>
          <p>
            <span className="font-medium text-foreground">Done when </span>
            {readings.implementer.done}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Both readings come from one model. A divergence points to possibly
          ambiguous text, not to two people disagreeing.
        </p>
      </div>
    </details>
  );
}

// The run's synopsis, clamped with an explicit way to read all of it.
function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 260;
  return (
    <div className="mt-3">
      <p
        className={cn(
          "text-[14px] leading-relaxed",
          long && !open && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[13px] font-medium text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-foreground"
        >
          {open ? "Show less" : "Read full summary"}
        </button>
      )}
    </div>
  );
}

function FindingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="grid grid-cols-[5.5rem_1fr] items-baseline gap-2 text-[13px] leading-relaxed">
      <span className="font-mono text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </span>
      <span>{children}</span>
    </p>
  );
}

// ─── Lictory Actions on pull requests ──────────────────────────────────────
// Modelled on CI checks: every head commit gets a run of each action; the
// newest run is the check's status; older runs stay inspectable; findings are
// annotations. The Lictory Intelligence review is the only action today.

const policyCopy = {
  off: "Off for this project: runs only when someone starts it.",
  advisory:
    "Advisory: reviews every new commit. Findings inform, merge isn't blocked.",
  required:
    "Required: merge waits for a review of the latest commit. Blockers open blocking discussions.",
} as const;

function useActionPolicy() {
  const { item } = useItem();
  const { projects } = useWorkspace();
  return (
    projects.find((p) => p.id === item.projectId)?.aiActionPolicy ?? "advisory"
  );
}

export function actionCheck(
  latest: Run | undefined,
  sourceHeadId: string | undefined,
  policy: "off" | "advisory" | "required",
): { state: CheckState; summary: string } {
  if (!latest)
    return {
      state: "neutral",
      summary:
        policy === "off"
          ? "Not run. Start it whenever you want a review."
          : "Starts when the pull request is ready for review.",
    };
  if (latest.status === "queued")
    return { state: "pending", summary: "Queued for the latest commit" };
  if (latest.status === "running")
    return { state: "running", summary: "Reviewing the latest commit…" };
  if (latest.status === "failed")
    return { state: "failure", summary: latest.error ?? "The run failed." };
  if (latest.status === "superseded")
    return { state: "skipped", summary: "Cancelled by a newer commit" };
  if (latest.headCommitId !== sourceHeadId)
    return {
      state: "neutral",
      summary: "Out of date: reviewed an earlier commit",
    };
  const blockers = latest.findings.filter((f) => f.severity === "blocker");
  return {
    state: blockers.length ? "failure" : "success",
    summary: `${latest.score ?? 0}/100 · ${
      blockers.length
        ? `${blockers.length} blocking ${blockers.length === 1 ? "finding" : "findings"}`
        : `${latest.findings.length} ${latest.findings.length === 1 ? "finding" : "findings"}`
    }`,
  };
}

function runState(run: Run, sourceHeadId: string | undefined): CheckState {
  return actionCheck(run, sourceHeadId, "advisory").state;
}

// One compact line for the merge box and the sidebar, GitHub-checks style.
export function ActionCheckRow({
  pullRequestId,
  sourceHeadId,
  onDetails,
}: {
  pullRequestId: string;
  sourceHeadId: string | undefined;
  onDetails: () => void;
}) {
  const runs = useAiRuns("pr_action", pullRequestId).filter(
    (r) => r.status !== "superseded",
  );
  const blocker = useAiBlocker();
  const policy = useActionPolicy();
  const { directory } = useWorkspace();
  const [latest] = runs;
  if (!latest && blocker) return null;
  const check = actionCheck(latest, sourceHeadId, policy);
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <CheckIcon state={check.state} />
      <IntelligenceMark className="size-3.5 text-muted-foreground" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">{INTELLIGENCE_REVIEW_ACTION}</span>{" "}
        <span className="text-muted-foreground">— {check.summary}</span>
      </p>
      {policy === "required" && directory.ai.enabled && (
        <Badge tone="info">Required</Badge>
      )}
      <Button size="sm" variant="ghost" onClick={onDetails}>
        Details
      </Button>
    </div>
  );
}

// The Checks tab: run history on the left, the selected run on the right.
export function ActionChecksPanel({
  pullRequest,
  sourceHeadId,
  canCommit,
  sourceName,
}: {
  pullRequest: EntityOf<"pullRequest">;
  sourceHeadId: string | undefined;
  canCommit: boolean;
  sourceName: string;
}) {
  const { item, mutateConfirmed, readOnly, memberName } = useItem();
  const { directory } = useWorkspace();
  const runs = useAiRuns("pr_action", pullRequest.id);
  const ordinal = useMemo(
    () => new Map([...runs].reverse().map((r, i) => [r.id, i + 1] as const)),
    [runs],
  );
  const blocker = useAiBlocker();
  const policy = useActionPolicy();
  const { run, pending, error } = useCommand();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0];
  const open = pullRequest.status !== "merged";
  const busy = runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  const rerun = () =>
    void run(mutateConfirmed, {
      type: "rerunAiAction",
      workItemId: item.id,
      pullRequestId: pullRequest.id,
      runId: crypto.randomUUID(),
    }).then((ok) => ok && setSelectedId(undefined));
  const rerunButton = open && !readOnly && (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || Boolean(blocker) || busy}
      title={blocker ?? (busy ? "A run is already in progress." : undefined)}
      onClick={rerun}
    >
      <RotateCcw className="size-3.5" />
      {runs.length ? "Re-run" : `Run ${INTELLIGENCE_REVIEW_ACTION}`}
    </Button>
  );
  return (
    <section aria-label="Lictory Actions" className="space-y-3">
      <SectionLabel>Lictory Actions</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <IntelligenceMark className="size-4 text-primary" />{" "}
            {INTELLIGENCE_REVIEW_ACTION}
            {policy === "required" && directory.ai.enabled && (
              <Badge tone="info">Required</Badge>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {blocker ?? policyCopy[policy]}
          </p>
        </div>
        {rerunButton}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!runs.length ? (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <StateIllustration kind="knowledge" />
          <p className="mt-2 text-sm font-medium">No runs yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            The {INTELLIGENCE_REVIEW_ACTION} reads the proposed change against
            the current specification and reports gaps, contradictions and
            ambiguity. It never changes the branch on its own.
          </p>
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-lg border md:grid-cols-[220px_minmax(0,1fr)]">
          <ol
            aria-label="Runs"
            className="max-h-130 overflow-y-auto border-b bg-muted/20 md:border-r md:border-b-0"
          >
            {runs.map((r) => {
              const active = r.id === selected?.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                      active && "bg-muted",
                    )}
                  >
                    <CheckIcon
                      state={runState(r, sourceHeadId)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">
                        Run #{ordinal.get(r.id)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        <code>{r.headCommitId?.slice(0, 7)}</code> ·{" "}
                        {relativeTime(r.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {selected && (
            <RunDetail
              run={selected}
              number={ordinal.get(selected.id) ?? 1}
              current={selected.headCommitId === sourceHeadId}
              sourceHeadId={sourceHeadId}
              sourceName={sourceName}
              requestedBy={memberName(selected.requestedById)}
              canCommit={canCommit && open && !readOnly}
              pending={pending}
              onCommit={(findingId) =>
                void run(mutateConfirmed, {
                  type: "applyAiSuggestion",
                  workItemId: item.id,
                  runId: selected.id,
                  findingId,
                })
              }
            />
          )}
        </div>
      )}
    </section>
  );
}

function RunDetail({
  run: r,
  number,
  current,
  sourceHeadId,
  sourceName,
  requestedBy,
  canCommit,
  pending,
  onCommit,
}: {
  run: Run;
  number: number;
  current: boolean;
  sourceHeadId: string | undefined;
  sourceName: string;
  requestedBy: string;
  canCommit: boolean;
  pending: boolean;
  onCommit: (findingId: string) => void;
}) {
  const state = runState(r, sourceHeadId);
  const statusLabel =
    r.status === "completed"
      ? current
        ? "Completed"
        : "Completed · earlier commit"
      : r.status === "superseded"
        ? "Cancelled · a newer commit arrived"
        : r.status[0]!.toUpperCase() + r.status.slice(1);
  const ordered = [...r.findings].sort(
    (a, b) =>
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );
  return (
    <div className="min-w-0 space-y-4 p-4">
      <div className="flex items-start gap-3">
        <CheckIcon state={state} className="mt-0.5 size-5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {INTELLIGENCE_REVIEW_ACTION} · Run #{number}
          </h3>
          <p className="text-xs text-muted-foreground">{statusLabel}</p>
        </div>
        {r.status === "completed" && r.score !== null && (
          <ScoreRing score={r.score} size={40} />
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3 text-xs sm:grid-cols-4">
        {(
          [
            [
              "Commit",
              <code key="c">{r.headCommitId?.slice(0, 7) ?? "—"}</code>,
            ],
            ["Triggered by", requestedBy],
            ["Started", relativeTime(r.startedAt ?? r.createdAt)],
            [
              "Duration",
              duration(r.startedAt, r.completedAt) ??
                (r.status === "running" || r.status === "queued" ? "…" : "—"),
            ],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {(r.status === "queued" || r.status === "running") && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {r.status === "queued"
            ? "Waiting to start…"
            : "Reading the change against the specification…"}
        </p>
      )}
      {r.status === "failed" && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {r.error ?? "The run failed."} Re-run it once the problem is fixed.
        </p>
      )}
      {r.summary && (
        <section className="space-y-1">
          <SectionLabel>Summary</SectionLabel>
          <p className="text-[13px] leading-5">{r.summary}</p>
        </section>
      )}
      <GroundedIn context={r.intelligenceContext} />
      {r.strengths.length > 0 && (
        <section className="space-y-1">
          <SectionLabel>What the change gets right</SectionLabel>
          <ul className="space-y-1 text-[13px]">
            {r.strengths.map((s) => (
              <li key={s} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.status === "completed" && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel>Annotations</SectionLabel>
            {counts(r.findings).map(([s, n]) => (
              <Badge key={s} tone={severityMeta[s].tone}>
                {n} {severityMeta[s].label.toLowerCase()}
              </Badge>
            ))}
          </div>
          {!ordered.length ? (
            <p className="text-sm text-muted-foreground">
              No findings on this commit.
            </p>
          ) : (
            <>
              {!current && ordered.some((f) => f.edit) && (
                <p className="text-xs text-muted-foreground">
                  Suggestions from an earlier commit can&apos;t be committed.
                  Re-run on the latest commit to get applicable suggestions.
                </p>
              )}
              {ordered.map((f) => {
                const applied = r.appliedFindingIds.includes(f.id);
                return (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    action={
                      !f.edit ? null : applied ? (
                        <span className="inline-flex items-center gap-1 text-xs text-success">
                          <Check className="size-3" /> Committed to {sourceName}
                        </span>
                      ) : current && canCommit ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          title={`Adds a commit to ${sourceName}. Reviewers will need to approve again.`}
                          onClick={() => onCommit(f.id)}
                        >
                          Commit suggestion
                        </Button>
                      ) : null
                    }
                  />
                );
              })}
            </>
          )}
        </section>
      )}
      {r.model && (
        <p className="text-[11px] text-muted-foreground">Model: {r.model}</p>
      )}
    </div>
  );
}

// Mirrors the server's merge gate so the merge box can explain itself.
export function useActionGate(
  pullRequestId: string,
  sourceHeadId: string | undefined,
) {
  const { item } = useItem();
  const { directory, projects } = useWorkspace();
  const runs = useAiRuns("pr_action", pullRequestId).filter(
    (r) => r.status !== "superseded",
  );
  const policy = projects.find((p) => p.id === item.projectId)?.aiActionPolicy;
  if (policy !== "required" || !directory.ai.enabled || !directory.ai.available)
    return undefined;
  const [latest] = runs;
  if (!latest)
    return `The ${INTELLIGENCE_REVIEW_ACTION} has not reviewed this pull request.`;
  if (latest.status === "queued" || latest.status === "running")
    return `The ${INTELLIGENCE_REVIEW_ACTION} is still reviewing the latest commit.`;
  if (latest.status === "failed")
    return `The ${INTELLIGENCE_REVIEW_ACTION} failed. Re-run it.`;
  if (latest.headCommitId !== sourceHeadId)
    return `The ${INTELLIGENCE_REVIEW_ACTION} has not reviewed the latest commit.`;
  return undefined;
}
