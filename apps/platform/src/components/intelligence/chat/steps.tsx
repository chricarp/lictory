import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import {
  AlertTriangle,
  Brain,
  Check,
  CircleCheck,
  FileText,
  PenLine,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { Link } from "@lictory/platform/lib/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@lictory/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@lictory/ui/ai/item";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
  type TraceStatus,
} from "@lictory/ui/ai/trace";
import { cn } from "@lictory/core/lib/utils";
import {
  describeStep,
  subjectText,
  summarizeChanges,
  type Change,
  type ItemRef,
  type KnownEntity,
  type Lookup,
  type PageEvidence,
  type Step,
  type Subject,
} from "@lictory/platform/components/intelligence/chat/activity";
import { PageCitations } from "@lictory/platform/components/intelligence/citations";
import { Markdown } from "@lictory/platform/components/items/markdown";

// The steps of one answer, as AI Elements draws them: every step is a line of
// a Trace (an icon, a title in the step's tense, the thing it touched), and a
// step that waits for the person is an Item outside the Trace, because it is
// a question, not something Litto did.

export type AnyToolPart = ToolUIPart | DynamicToolUIPart;

// One tool call, described for people and classified by its state.
export type Activity = {
  part: AnyToolPart;
  step: Step;
  running: boolean;
  failed: boolean;
  declined: boolean;
  awaiting: boolean;
  done: boolean;
};

// `interrupted`: the turn ended (stopped, failed or superseded) while this
// call was still in flight, so it never finished.
export function activityOf(
  part: AnyToolPart,
  lookup: Lookup,
  interrupted: boolean,
): Activity {
  const step = describeStep(
    getToolName(part),
    part.input,
    part.state === "output-available" ? part.output : undefined,
    part.state === "output-error" ? part.errorText : undefined,
    lookup,
  );
  const inFlight =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "approval-responded" && part.approval.approved);
  const declined =
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved);
  return {
    part,
    step,
    running: inFlight && !interrupted,
    declined,
    failed: step.outcome.error !== null || (inFlight && interrupted),
    awaiting: part.state === "approval-requested",
    done: part.state === "output-available",
  };
}

export function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function useElapsed(active: boolean) {
  const [started] = useState(() => performance.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(
      () => setSeconds(Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [active, started]);
  return seconds;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current motion-reduce:animate-none",
        className,
      )}
    />
  );
}

// The assistant is busy with nothing to show yet. Short pauses between steps
// stay invisible (`delay`) so the transcript does not flicker.
export function ThinkingLine({
  label = "Thinking",
  delay = 0,
}: {
  label?: string;
  delay?: number;
}) {
  const [shown, setShown] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const seconds = useElapsed(shown);
  if (!shown) return null;
  return (
    <TraceLine status="running" role="status" className="activity-enter">
      <TraceIcon>
        <Spinner />
      </TraceIcon>
      <TraceTitle className="font-medium">{label}</TraceTitle>
      {seconds >= 3 && <TraceDescription>{seconds}s</TraceDescription>}
    </TraceLine>
  );
}

// Reasoning: one line, "Thinking" with the latest thought as a preview
// while the model thinks, "Thought for 4s" once done. The full reasoning
// opens on demand, so the answer below never jumps as it starts and stops.
export function ReasoningStep({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [started] = useState(() => performance.now());
  // Only reasoning seen streaming knows how long it took.
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!streaming) return;
    return () => setSeconds(Math.round((performance.now() - started) / 1000));
  }, [streaming, started]);
  if (!text && !streaming) return null;
  const latest = streaming
    ? (text
        .trim()
        .split(/\n+|(?<=[.!?])\s+/)
        .filter(Boolean)
        .at(-1) ?? "")
    : "";
  const line = (
    <TraceLine
      status={streaming ? "running" : undefined}
      className="max-w-full"
    >
      <TraceIcon>{streaming ? <Spinner /> : <Brain />}</TraceIcon>
      <TraceTitle className={cn("shrink-0", streaming && "font-medium")}>
        {streaming
          ? "Thinking"
          : seconds && seconds > 1
            ? `Thought for ${seconds}s`
            : "Thought"}
      </TraceTitle>
      {latest && (
        <span className="min-w-0 truncate text-muted-foreground/70">
          {latest}
        </span>
      )}
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">
        {text}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function StepIcon({ activity }: { activity: Activity }) {
  const { step, running, failed, declined, awaiting } = activity;
  if (running) return <Spinner />;
  if (failed) return <AlertTriangle />;
  if (declined) return <ShieldX />;
  if (awaiting) return <ShieldAlert className="text-warning" />;
  if (step.kind === "search") return <Search />;
  if (step.kind === "read") return <FileText />;
  return <PenLine />;
}

function statusOf(activity: Activity): TraceStatus | undefined {
  if (activity.running) return "running";
  if (activity.failed) return "error";
  if (activity.awaiting) return "waiting";
  return undefined;
}

export function SubjectChip({ subject }: { subject: Subject }) {
  return (
    <span className="inline-flex h-5.5 max-w-full min-w-0 items-center gap-1.5 truncate rounded-md bg-muted/70 px-1.5 text-[12px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--border)]">
      {subject.kind === "item" ? (
        <>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {subject.item.key}
          </span>
          {subject.item.title && (
            <span className="min-w-0 truncate">{subject.item.title}</span>
          )}
        </>
      ) : (
        <span className="min-w-0 truncate">{subjectText(subject)}</span>
      )}
    </span>
  );
}

function titleOf(activity: Activity) {
  const { step, running, failed, declined, awaiting } = activity;
  if (running) return step.running;
  if (awaiting) return `${step.action} · waiting for you`;
  if (declined) return `Declined: ${step.action.toLowerCase()}`;
  if (failed) return `Could not ${step.action.toLowerCase()}`;
  return step.done;
}

// One tool call as a line; its detail opens under it.
// `quiet`: the failure is reported beside the answer, so the line does not
// repeat its error.
export function StepLine({
  activity,
  quiet,
}: {
  activity: Activity;
  quiet?: boolean;
}) {
  const { step } = activity;
  const title = titleOf(activity);
  const line = (
    <TraceLine status={statusOf(activity)} className="max-w-full">
      <TraceIcon>
        <StepIcon activity={activity} />
      </TraceIcon>
      <TraceTitle
        className={cn(
          "shrink-0",
          activity.running && "font-medium",
          activity.declined && "line-through decoration-muted-foreground/40",
        )}
      >
        {title}
      </TraceTitle>
      {step.subject && <SubjectChip subject={step.subject} />}
    </TraceLine>
  );
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger
        aria-label={`${title}${step.subject ? ` ${subjectText(step.subject)}` : ""}`}
      >
        {line}
      </TraceCollapsibleTrigger>
      {activity.failed && step.outcome.error && !quiet && (
        <p className="mt-0.5 ml-6 text-[12px] leading-5 text-destructive/80">
          {step.outcome.error}
        </p>
      )}
      <TraceCollapsibleContent>
        <StepDetail activity={activity} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ItemLink({ item }: { item: ItemRef }) {
  const content = (
    <>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {item.key}
      </span>
      {item.title && <span className="min-w-0 truncate">{item.title}</span>}
    </>
  );
  return item.href ? (
    <Link
      href={item.href}
      className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-foreground/85 hover:bg-muted/60"
    >
      {content}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-2 px-1 py-0.5">
      {content}
    </span>
  );
}

// What the step asked for and what came back, in words; the raw request and
// response stay one click away for anyone who needs to verify them.
function StepDetail({ activity }: { activity: Activity }) {
  const [raw, setRaw] = useState(false);
  const { part, step } = activity;
  const subjectItem =
    step.subject?.kind === "item" ? step.subject.item : undefined;
  const items = step.outcome.items.length
    ? step.outcome.items
    : subjectItem
      ? [subjectItem]
      : [];
  return (
    <div className="space-y-2 py-0.5 text-[12px]">
      {step.outcome.summary && <p>{step.outcome.summary}</p>}
      {items.length > 0 && (
        <div className="-mx-1 grid">
          {items.map((item) => (
            <ItemLink key={item.id ?? item.key} item={item} />
          ))}
        </div>
      )}
      {step.outcome.pages && <PageCitations pages={step.outcome.pages} />}
      {step.fields.length > 0 && <Fields fields={step.fields} />}
      <button
        type="button"
        onClick={() => setRaw((r) => !r)}
        aria-expanded={raw}
        className="text-[11.5px] text-muted-foreground/80 underline decoration-transparent underline-offset-2 transition-colors hover:text-foreground hover:decoration-current"
      >
        {raw ? "Hide raw data" : "Show raw data"}
      </button>
      {raw && (
        <div className="grid gap-2 text-[11px]">
          <Raw label="Request" value={part.input} />
          {part.state === "output-available" && (
            <Raw label="Response" value={part.output} />
          )}
          {part.state === "output-error" && (
            <Raw label="Error" value={part.errorText} />
          )}
        </div>
      )}
    </div>
  );
}

function Fields({ fields }: { fields: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {fields.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-foreground/85">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Raw({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 font-medium">{label}</p>
      <pre className="max-h-56 overflow-auto rounded-lg bg-muted/60 p-2 font-mono leading-4 whitespace-pre-wrap text-foreground/80">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// How many recent steps stay visible while a long run is in progress.
const RECENT_STEPS = 6;

// Consecutive tool calls of a live answer. A long run keeps its latest
// steps in view; earlier ones fold behind one line.
export function StepLines({
  activities,
  live,
  quiet,
}: {
  activities: Activity[];
  live: boolean;
  quiet?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden =
    showAll || !live ? 0 : Math.max(0, activities.length - RECENT_STEPS);
  return (
    <>
      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)}>
          <TraceLine status="pending">
            <TraceIcon>
              <span className="text-[11px]">+</span>
            </TraceIcon>
            <TraceTitle>
              {hidden} earlier {hidden === 1 ? "step" : "steps"}
            </TraceTitle>
          </TraceLine>
        </button>
      )}
      {activities.slice(hidden).map((activity) => (
        <StepLine
          key={activity.part.toolCallId}
          activity={activity}
          quiet={quiet}
        />
      ))}
    </>
  );
}

// Chain of Thought: once an answer is complete, the work behind it folds
// into one line ("Worked for 14s · 6 steps · 2 changes").
export function WorkSummary({
  ms,
  steps,
  changes,
  failed,
  watched,
  children,
}: {
  ms: number | undefined;
  steps: number;
  changes: number;
  failed: number;
  watched: boolean;
  children: ReactNode;
}) {
  // An answer watched as it streamed keeps its steps open, so nothing moves
  // under the reader when it completes; history opens folded.
  const [open, setOpen] = useState(watched);
  const detail = [
    steps > 0 ? `${steps} ${steps === 1 ? "step" : "steps"}` : null,
    changes > 0 ? `${changes} ${changes === 1 ? "change" : "changes"}` : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            {failed > 0 ? <AlertTriangle /> : <CircleCheck />}
          </TraceIcon>
          <TraceTitle>
            {ms ? `Worked for ${formatDuration(ms)}` : "Worked"}
          </TraceTitle>
          {detail && <TraceDescription>· {detail}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted>
        <Trace>{children}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Confirmation: a decision Litto may not take alone. It runs as the person,
// only if they approve; until then nothing has happened. The card shows
// exactly what would run, in full: an approval is never given to a summary.
export function Confirmation({
  activity,
  onDecide,
  known,
}: {
  activity: Activity;
  onDecide: (approved: boolean) => Promise<void>;
  // What earlier steps of this answer read about an id the action names.
  known?: (id: string) => KnownEntity | undefined;
}) {
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const { part, step } = activity;
  const reason =
    part.state === "approval-requested"
      ? part.approval.requestReason
      : undefined;
  const isId = ([, value]: [string, string]) => uuidPattern.test(value);
  const ids = step.detail.filter(isId);
  // The thing acted on, as an earlier step read it, so the card says which
  // discussion (or other record) this is and what changes about it.
  const target = ids
    .map(([label, id]) => ({ label, found: known?.(id) }))
    .find((t) => t.found);
  const before = (label: string): string | null => {
    const found = target?.found;
    if (!found) return null;
    if (label === "Blocking" && found.blocking !== null)
      return found.blocking ? "Yes" : "No";
    if (label === "Resolved" && found.status)
      return found.status === "resolved" ? "Yes" : "No";
    return null;
  };
  const readable = step.detail
    .filter((field) => !isId(field))
    .map(([label, value]): [string, string] => {
      const was = before(label);
      return [label, was && was !== value ? `${was} → ${value}` : value];
    });
  const decide = (approved: boolean) => {
    setDeciding(approved);
    // Still on screen once sent: it was not applied, so it can be answered
    // again (the conversation shows why).
    void onDecide(approved).then(() => setDeciding(null));
  };
  return (
    <Item
      data-litto-waiting
      tabIndex={-1}
      variant="attention"
      role="group"
      aria-label={`${step.action}: waiting for your approval`}
      className="activity-enter items-start"
    >
      <ItemMedia
        variant="icon"
        className="bg-warning/12 text-warning"
        aria-hidden
      >
        <ShieldAlert />
      </ItemMedia>
      <ItemContent className="gap-1">
        <ItemTitle className="flex-wrap">{step.action}?</ItemTitle>
        {step.subject && (
          <div className="flex min-w-0">
            <SubjectChip subject={step.subject} />
          </div>
        )}
        <ItemDescription>
          {reason ??
            "Nothing happens until you approve. Litto then does this as you, with your permissions."}
        </ItemDescription>
      </ItemContent>
      {target?.found?.excerpt && (
        <blockquote className="basis-full border-l-2 border-warning/50 pl-3 text-[12.5px] leading-5 text-foreground/85">
          <span className="mb-0.5 block text-[11.5px] font-medium text-muted-foreground not-italic">
            {target.label === "Thread" ? "Discussion" : target.label}
            {target.found.status ? ` · ${target.found.status}` : ""}
            {target.found.blocking ? " · blocking" : ""}
          </span>
          “{target.found.excerpt}”
        </blockquote>
      )}
      {readable.length > 0 && (
        <dl className="grid basis-full gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[12.5px]">
          {readable.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11.5px] font-medium text-muted-foreground">
                {label}
              </dt>
              <dd className="mt-0.5 min-w-0 break-words text-foreground">
                {value.length > 90 || value.includes("\n") ? (
                  <Markdown
                    source={value}
                    className="text-[12.5px] leading-5 [&_p]:my-1.5"
                  />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {ids.length > 0 && (
        // References with no readable name stay exact, one click away.
        <details className="basis-full text-[12px] text-muted-foreground">
          <summary className="cursor-pointer rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            Technical details
          </summary>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {ids.map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="min-w-0 font-mono text-[11.5px] break-all select-all">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <ItemFooter className="justify-end">
        <ItemActions>
          <Button
            variant="ghost"
            size="sm"
            disabled={deciding !== null}
            onClick={() => decide(false)}
            className="touch:h-11 touch:px-4"
          >
            {deciding === false ? "Declining…" : "Decline"}
          </Button>
          <Button
            size="sm"
            disabled={deciding !== null}
            onClick={() => decide(true)}
            className="touch:h-11 touch:px-4"
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            {deciding === true ? "Approving…" : step.action}
          </Button>
        </ItemActions>
      </ItemFooter>
    </Item>
  );
}

// Sources: the page versions the answer rests on, linked to the exact version
// read. Short lists stay open; long ones fold behind their count.
export function Sources({ pages }: { pages: PageEvidence[] }) {
  const [open, setOpen] = useState(pages.length <= 3);
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <FileText />
          </TraceIcon>
          <TraceTitle>
            Read {pages.length} {pages.length === 1 ? "page" : "pages"}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="text-[12.5px]">
        <PageCitations pages={pages} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

// Steps that did not complete, kept beside the answer after the rest of the
// work folds: what the reply says it did is checked against what happened.
export function Failures({
  activities,
  onFollowUp,
}: {
  activities: Activity[];
  // Puts a follow-up about the failure in the composer, for the person to
  // edit and send: Litto never retries a failed action on its own.
  onFollowUp?: (prompt: string) => void;
}) {
  const prompt = `${activities
    .map(
      (a) =>
        `“${titleOf(a)}” did not complete${a.step.outcome.error ? `: ${a.step.outcome.error}` : "."}`,
    )
    .join(" ")} What should we do instead?`;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5">
      <div
        role="list"
        aria-label="Steps that did not complete"
        className="flex flex-col gap-1.5"
      >
        {activities.map((a) => (
          <div role="listitem" key={a.part.toolCallId} className="min-w-0">
            <TraceLine status="error" className="max-w-full">
              <TraceIcon>
                <AlertTriangle />
              </TraceIcon>
              <TraceTitle className="font-medium">{titleOf(a)}</TraceTitle>
              {a.step.subject && <SubjectChip subject={a.step.subject} />}
            </TraceLine>
            <p className="mt-0.5 ml-6 text-[12px] leading-5 text-foreground/75">
              {a.step.outcome.error ??
                "It was interrupted, and its completion was not confirmed."}
            </p>
          </div>
        ))}
      </div>
      {onFollowUp && (
        <div className="ml-6">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onFollowUp(prompt)}
            className="touch:h-11 touch:px-4"
          >
            Ask Litto what to do instead
          </Button>
        </div>
      )}
    </div>
  );
}

// Up to this many changes show as lines; more fold behind one summary.
const INLINE_CHANGES = 3;

function ChangeLine({ change }: { change: Change }) {
  const item = change.subject.kind === "item" ? change.subject.item : undefined;
  const body = (
    <TraceLine className="max-w-full">
      <TraceIcon className="text-success">
        <Check strokeWidth={3} />
      </TraceIcon>
      <span className="shrink-0">{change.verb}</span>
      {item ? (
        <>
          <span className="shrink-0 font-mono text-[11.5px] text-foreground/80">
            {item.key}
          </span>
          {item.title && (
            <TraceTitle className="text-foreground/85">{item.title}</TraceTitle>
          )}
        </>
      ) : (
        <TraceTitle className="text-foreground/85">
          {subjectText(change.subject)}
        </TraceTitle>
      )}
    </TraceLine>
  );
  return item?.href ? <Link href={item.href}>{body}</Link> : <div>{body}</div>;
}

// The items this answer changed, kept beside the answer after its steps fold.
export function Changes({ changes }: { changes: Change[] }) {
  const [open, setOpen] = useState(false);
  if (changes.length <= INLINE_CHANGES)
    return (
      <Trace aria-label="Changes made" role="list" className="gap-0.5">
        {changes.map((change, i) => (
          <div role="listitem" key={i}>
            <ChangeLine change={change} />
          </div>
        ))}
      </Trace>
    );
  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger aria-label="Changes made">
        <TraceLine>
          <TraceIcon className="text-success">
            <Check strokeWidth={3} />
          </TraceIcon>
          <TraceTitle className="font-medium text-foreground">
            Changed {changes.length} items
          </TraceTitle>
          <TraceDescription>· {summarizeChanges(changes)}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="max-h-60 overflow-y-auto overscroll-contain">
          <Trace className="gap-0.5">
            {changes.map((change, i) => (
              <ChangeLine key={i} change={change} />
            ))}
          </Trace>
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
