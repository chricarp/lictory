"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
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
import { IntelligenceMark } from "~/components/logo";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  byType,
  identifier,
  relativeTime,
  segmentOf,
  typeOf,
} from "~/lib/work-items";
import {
  aiScoreBand,
  INTELLIGENCE_REVIEW_ACTION,
  type AiFinding,
  type AiSeverity,
} from "~/sync/shared/ai";
import type { Command, EntityOf } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import { StateIllustration } from "~/components/ui/state-illustration";
import { RevisionDiff } from "~/components/items/diff";
import { TypeIcon } from "~/components/items/icons";
import { useItem } from "~/components/items/item-context";
import { CheckIcon, duration, type CheckState } from "./flow-ui";
import { useWorkspace } from "~/components/workspace/provider";
import {
  ContextCitations,
  GroundedIn,
} from "~/components/intelligence/citations";

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
function useAiBlocker() {
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
  fair: "text-amber-600 dark:text-amber-400",
  poor: "text-destructive",
} as const;
const bandStroke = {
  good: "stroke-success",
  fair: "stroke-amber-500",
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
          strokeWidth="3"
          className="stroke-muted"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
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

const severityMeta: Record<
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
const counts = (findings: AiFinding[]) =>
  severityOrder
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0);

function RunProgress({ run, subject }: { run: Run; subject: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[13px]"
    >
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
      <div className="min-w-0">
        <p className="font-medium">
          {run.status === "queued" ? "Queued" : "Reviewing"} {subject}…
        </p>
        <p className="text-xs text-muted-foreground">
          Requested {relativeTime(run.createdAt)}. You can leave this page;
          results appear here when ready.
        </p>
      </div>
    </div>
  );
}

// Sidebar entry point: request, follow progress, see the score.
export function AiReviewPanel({ onOpen }: { onOpen: (runId: string) => void }) {
  const { item, project, mutateConfirmed, capabilities, readOnly, memberName } =
    useItem();
  const runs = useAiRuns("item_review");
  const blocker = useAiBlocker();
  const { run, pending, error } = useCommand();
  const [latest] = runs;
  const lastCompleted = runs.find((r) => r.status === "completed");
  const active = latest && ["queued", "running"].includes(latest.status);
  const allowed =
    capabilities.requestReviews || capabilities.editSpecifications;
  const request = () =>
    void run(mutateConfirmed, {
      type: "requestAiReview",
      workItemId: item.id,
      runId: crypto.randomUUID(),
    });
  const key = identifier(project, item.number);
  return (
    <section aria-labelledby="ai-review-title">
      <div className="mb-2 flex items-center gap-2">
        <IntelligenceMark className="size-3.5 text-primary" />
        <SectionLabel>
          <span id="ai-review-title">Lictory Intelligence review</span>
        </SectionLabel>
      </div>
      {active ? (
        <RunProgress
          run={latest}
          subject={`${key} with its parent and child items`}
        />
      ) : latest?.status === "failed" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[13px]">
          <p className="flex items-center gap-1.5 font-medium text-destructive">
            <XCircle className="size-4" /> Review failed
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{latest.error}</p>
        </div>
      ) : null}
      {!active && lastCompleted && (
        <button
          onClick={() => onOpen(lastCompleted.id)}
          className={cn(
            "mt-2 flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-left transition-colors duration-100 hover:bg-muted/60",
            lastCompleted.staleAt && "opacity-80",
          )}
        >
          <ScoreRing score={lastCompleted.score ?? 0} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">
              {lastCompleted.findings.length
                ? `${lastCompleted.findings.length} ${lastCompleted.findings.length === 1 ? "finding" : "findings"}`
                : "No findings"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {lastCompleted.staleAt
                ? `Outdated: ${lastCompleted.staleReason ?? "content changed"}`
                : `${memberName(lastCompleted.requestedById)} · ${relativeTime(lastCompleted.completedAt ?? lastCompleted.createdAt)}`}
            </p>
            {counts(lastCompleted.findings).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {counts(lastCompleted.findings).map(([s, n]) => (
                  <Badge key={s} tone={severityMeta[s].tone}>
                    {n} {severityMeta[s].label.toLowerCase()}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </button>
      )}
      {!active && (
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={pending || readOnly || !allowed || Boolean(blocker)}
            title={
              blocker ??
              (!allowed
                ? "Your roles cannot request reviews."
                : "Analyse this item with its parent and child items for missing information.")
            }
            onClick={request}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : lastCompleted ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <IntelligenceMark className="size-3.5" />
            )}
            {lastCompleted || latest?.status === "failed"
              ? "Run Lictory Intelligence review again"
              : "Request Lictory Intelligence review"}
          </Button>
          {blocker && !runs.length && (
            <p className="mt-1.5 text-xs text-muted-foreground">{blocker}</p>
          )}
          {!blocker && !runs.length && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Finds missing information, ambiguity and gaps across this item and
              its child items, like a refinement session would.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

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
      segmentOf(typeOf(workspace.delivery, i)),
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
          : workspace.engine.mutateConfirmed(command));
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
        : workspace.engine.mutateConfirmed(command));
      setAsked((a) => new Set(a).add(f.id));
    } catch {
      // The thread composer remains available on the item itself.
    }
  };
  const kinds = (["validation", "suggestion", "question"] as const).map(
    (k) => [k, run.findings.filter((f) => f.kind === k).length] as const,
  );
  const history = runs.filter((r) => r.status === "completed");
  return (
    <div className="space-y-6 pb-24">
      <BackButton onClose={onClose} />
      <header className="flex flex-wrap items-start gap-4">
        <ScoreRing score={run.score ?? 0} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Lictory Intelligence review of{" "}
            {identifier(ctx.project, ctx.item.number)}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Requested by {ctx.memberName(run.requestedById)} ·{" "}
            {relativeTime(run.completedAt ?? run.createdAt)} ·{" "}
            {Object.keys(run.contextRevisions).length} items analysed
            {run.model ? ` · ${run.model}` : ""}
          </p>
          {run.summary && (
            <p className="mt-2 text-[14px] leading-6">{run.summary}</p>
          )}
        </div>
      </header>
      <GroundedIn context={run.intelligenceContext} />
      {run.staleAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[13px]">
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
        <section>
          <SectionLabel className="mb-1.5">What works</SectionLabel>
          <ul className="space-y-1 text-[13px]">
            {run.strengths.map((s) => (
              <li key={s} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}
      <nav aria-label="Filter findings" className="flex flex-wrap gap-1.5">
        {([["all", run.findings.length] as const, ...kinds] as const).map(
          ([k, n]) => (
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
          ),
        )}
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
        "rounded-lg border bg-card p-3.5 transition-colors duration-100",
        selected && "border-primary/50 bg-primary/3",
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
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={severityMeta[f.severity].tone}>
              {severityMeta[f.severity].label}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Kind className="size-3.5" /> {kindMeta[f.kind].label} ·{" "}
              {f.category.replaceAll("_", " ")}
            </span>
          </div>
          <p className="text-[14px] leading-5 font-medium">{f.title}</p>
          {!compact && (
            <p className="text-[13px] leading-5 text-muted-foreground">
              {f.detail}
            </p>
          )}
          {!compact &&
            f.evidence.map((e) => (
              <blockquote
                key={e}
                className="border-l-2 pl-2.5 text-[13px] text-muted-foreground italic"
              >
                {e}
              </blockquote>
            ))}
          {f.question && (
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[13px]">
              <span className="font-medium">Question for the team: </span>
              {f.question}
            </p>
          )}
          {!compact && f.recommendation && (
            <p className="text-[13px]">
              <span className="font-medium">Recommendation: </span>
              {f.recommendation}
            </p>
          )}
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

// ─── Lictory Actions on pull requests ──────────────────────────────────────
// Modelled on CI checks: every head commit gets a run of each action; the
// newest run is the check's status; older runs stay inspectable; findings are
// annotations. The Lictory Intelligence review is the only action today.

const policyCopy = {
  off: "Off for this team: runs only when someone starts it.",
  advisory:
    "Advisory: reviews every new commit. Findings inform, merge isn't blocked.",
  required:
    "Required: merge waits for a review of the latest commit. Blockers open blocking discussions.",
} as const;

function useActionPolicy() {
  const { item } = useItem();
  const { delivery } = useWorkspace();
  return delivery.teams.get(item.teamId)?.aiActionPolicy ?? "advisory";
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
  const { directory, delivery } = useWorkspace();
  const runs = useAiRuns("pr_action", pullRequestId).filter(
    (r) => r.status !== "superseded",
  );
  const policy = delivery.teams.get(item.teamId)?.aiActionPolicy;
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
