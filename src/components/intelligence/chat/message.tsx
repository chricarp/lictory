"use client";
import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  LocateFixed,
  PenLine,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkle,
} from "lucide-react";
import Link from "next/link";
import {
  IntelligenceMark,
  useAfterglow,
  type IntelligenceMood,
} from "~/components/intelligence/mark";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Markdown } from "~/components/items/markdown";
import { Button } from "~/components/ui/button";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type AskQuestionsInput,
  type AskQuestionsOutput,
  type ChatContext,
  type ChatMessage,
  type RecommendActionInput,
  type RecommendActionOutput,
} from "~/intelligence/chat/shared";
import type { Insights } from "~/intelligence/insights";
import { cn } from "~/lib/utils";
import {
  changesOf,
  describeStep,
  subjectText,
  summarizeChanges,
  summarizeSteps,
  type Change,
  type ItemRef,
  type Lookup,
  type Step,
  type Subject,
} from "./activity";
import { InsightCards } from "./insights";
import { answerMood } from "./mood";
import { AnsweredQuestions, Questionnaire } from "./questionnaire";
import { DecidedRecommendation, RecommendationCard } from "./recommendation";
import { useLookup } from "./use-lookup";

type Part = ChatMessage["parts"][number];
// Tools answered by the person in the chat rather than run on the server.
const interactive = new Set<string>([ASK_QUESTIONS, RECOMMEND_ACTION]);
type AnyToolPart = ToolUIPart | DynamicToolUIPart;

// One tool call, described for people and classified by its state.
type Activity = {
  part: AnyToolPart;
  step: Step;
  running: boolean;
  failed: boolean;
  declined: boolean;
  awaiting: boolean;
  done: boolean;
};

function insightsOf(activities: Activity[]): Insights[] {
  return activities.flatMap((a) =>
    getToolName(a.part) === "getInsights" &&
    a.part.state === "output-available" &&
    !a.failed
      ? [(a.part.output as { result: Insights }).result]
      : [],
  );
}

function activityOf(part: AnyToolPart, lookup: Lookup): Activity {
  const step = describeStep(
    getToolName(part),
    part.input,
    part.state === "output-available" ? part.output : undefined,
    part.state === "output-error" ? part.errorText : undefined,
    lookup,
  );
  const running =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "approval-responded" && part.approval.approved);
  const declined =
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved);
  return {
    part,
    step,
    running,
    declined,
    failed: step.outcome.error !== null,
    awaiting: part.state === "approval-requested",
    done: part.state === "output-available",
  };
}

export function MessageView({
  message,
  streaming,
  isLast,
  failed,
  onAnswer,
  onDecide,
  onApprove,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
  failed?: boolean;
  onAnswer: (toolCallId: string, output: AskQuestionsOutput) => void;
  onDecide: (toolCallId: string, output: RecommendActionOutput) => void;
  onApprove: (approvalId: string, approved: boolean) => void;
  onRegenerate?: () => void;
}) {
  const reduce = useReducedMotion();
  const lookup = useLookup();
  // Whether this answer streamed in front of the reader, so its steps fold
  // away visibly when it finishes (history loads already folded).
  const live = streaming && isLast;
  const [sawLive, setSawLive] = useState(live);
  if (live && !sawLive) setSawLive(true);
  if (message.role === "user") {
    const text = message.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n");
    const context = message.parts.find((p) => p.type === "data-context")?.data;
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
        className="flex flex-col items-end gap-1.5"
      >
        {context && <SentContext context={context} />}
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-6 whitespace-pre-wrap">
          {text}
        </div>
      </motion.div>
    );
  }

  // Group consecutive tool calls into one stretch of activity.
  const blocks: (
    { kind: "tools"; activities: Activity[] } | { kind: "part"; part: Part }
  )[] = [];
  for (const part of message.parts) {
    // Step boundaries are invisible; skipping them keeps the tool calls of
    // consecutive steps in one stretch of activity.
    if (part.type === "step-start") continue;
    if (isToolUIPart(part) && !interactive.has(getToolName(part))) {
      const activity = activityOf(part, lookup);
      const prev = blocks.at(-1);
      if (prev?.kind === "tools") prev.activities.push(activity);
      else blocks.push({ kind: "tools", activities: [activity] });
    } else blocks.push({ kind: "part", part });
  }
  // Once the answer is complete, the work that led to it (tool calls,
  // reasoning, answered questions, interim notes) folds behind "Worked for…",
  // leaving the final answer. Anything still waiting for the person stays open.
  type Block = (typeof blocks)[number];
  const isText = (b: Block) => b.kind === "part" && b.part.type === "text";
  const isWork = (b: Block) =>
    b.kind === "tools" || b.part.type === "reasoning" || isToolUIPart(b.part);
  const lastWork = blocks.findLastIndex(isWork);
  const waiting = message.parts.some(
    (p) =>
      isToolUIPart(p) &&
      (p.state === "approval-requested" ||
        (interactive.has(getToolName(p)) && p.state === "input-available")),
  );
  const answerBlocks = blocks.slice(lastWork + 1);
  const fold =
    !live &&
    !waiting &&
    lastWork >= 0 &&
    answerBlocks.some(
      (b) =>
        isText(b) &&
        b.kind === "part" &&
        b.part.type === "text" &&
        b.part.text.trim() !== "",
    );
  const work = fold ? blocks.slice(0, lastWork + 1) : [];
  const shown = fold ? answerBlocks : blocks;
  const activities = blocks.flatMap((b) =>
    b.kind === "tools" ? b.activities : [],
  );
  const steps = work.reduce(
    (n, b) =>
      n + (b.kind === "tools" ? b.activities.length : isWork(b) ? 1 : 0),
    0,
  );
  const changes = live ? [] : changesOf(activities);
  // Figures the workspace computed stay visible: after the steps that
  // produced them, or above the answer once those steps fold away.
  const foldedInsights = fold ? insightsOf(activities) : [];
  const text = shown
    .flatMap((b) =>
      b.kind === "part" && b.part.type === "text" ? [b.part.text] : [],
    )
    .join("\n\n");
  const visible = blocks.filter(
    (b) =>
      b.kind === "tools" ||
      (b.part.type === "text" && b.part.text.trim() !== "") ||
      b.part.type === "reasoning" ||
      isToolUIPart(b.part),
  );
  // Between steps the model is deciding what to do next; say so instead of
  // leaving the last finished step looking like the end.
  const tail = visible.at(-1);
  const pausing =
    live &&
    !waiting &&
    (!tail ||
      (tail.kind === "tools" &&
        !tail.activities.some((a) => a.running || a.awaiting)));
  const lastTextIndex = blocks.findLastIndex(isText);

  function renderBlock(block: Block, i: number) {
    if (block.kind === "tools") {
      const reports = fold ? [] : insightsOf(block.activities);
      return (
        <Fragment key={i}>
          <ActivityGroup
            activities={block.activities}
            live={live}
            onApprove={onApprove}
          />
          {reports.length > 0 && <InsightCards reports={reports} />}
        </Fragment>
      );
    }
    const part = block.part;
    if (part.type === "text")
      return part.text ? (
        <motion.div
          key={i}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <Markdown
            source={part.text}
            className={cn(
              "chat-prose text-[14px] leading-7 [&_h2]:mt-5 [&_h2]:text-base",
              live &&
                i === lastTextIndex &&
                part.state === "streaming" &&
                "chat-streaming",
            )}
          />
        </motion.div>
      ) : null;
    if (part.type === "reasoning")
      return (
        <Reasoning
          key={i}
          text={part.text}
          streaming={part.state === "streaming"}
        />
      );
    if (isToolUIPart(part) && getToolName(part) === ASK_QUESTIONS) {
      const input = part.input as AskQuestionsInput | undefined;
      if (part.state === "input-streaming" || !input?.questions)
        return <Working key={i} label="Preparing questions" />;
      if (part.state === "output-available")
        return (
          <AnsweredQuestions
            key={i}
            input={input}
            output={part.output as AskQuestionsOutput}
          />
        );
      if (part.state === "input-available")
        return (
          <Questionnaire
            key={part.toolCallId}
            input={input}
            onSubmit={(output) => onAnswer(part.toolCallId, output)}
          />
        );
    }
    if (isToolUIPart(part) && getToolName(part) === RECOMMEND_ACTION) {
      const input = part.input as RecommendActionInput | undefined;
      if (part.state === "input-streaming" || !input?.question)
        return <Working key={i} label="Preparing a recommendation" />;
      if (part.state === "output-available")
        return (
          <DecidedRecommendation
            key={i}
            input={input}
            output={part.output as RecommendActionOutput}
          />
        );
      if (part.state === "input-available")
        return (
          <RecommendationCard
            key={part.toolCallId}
            input={input}
            onDecide={(output) => onDecide(part.toolCallId, output)}
          />
        );
    }
    return null;
  }

  return (
    <div className="group/message flex gap-3">
      <AssistantMark
        mood={answerMood(message, live)}
        active={live}
        failed={failed}
      />
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {fold && (
          <WorkedFor
            ms={message.metadata?.workedMs}
            steps={steps}
            collapseOnMount={sawLive && !reduce}
          >
            {work.map((block, i) => renderBlock(block, i))}
          </WorkedFor>
        )}
        {foldedInsights.length > 0 && <InsightCards reports={foldedInsights} />}
        {shown.map((block, i) =>
          renderBlock(block, fold ? lastWork + 1 + i : i),
        )}
        {pausing && (
          <Working
            key={visible.length}
            label="Thinking"
            delay={tail ? 450 : 0}
          />
        )}
        {changes.length > 0 && <Changes changes={changes} />}
        {!streaming && text && (
          <div className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100">
            <CopyButton text={text} />
            {isLast && onRegenerate && (
              <IconAction label="Regenerate" onClick={onRegenerate}>
                <RotateCcw className="size-3.5" />
              </IconAction>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

// Height follows content through a grid-row transition, which stays smooth
// when toggled mid-way and never measures the DOM.
function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
      inert={!open}
    >
      <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  icon,
  children,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "-mx-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors duration-100 hover:bg-muted/70 hover:text-foreground",
        className,
      )}
    >
      {icon}
      {children}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-200 ease-out",
          open && "rotate-180",
        )}
        aria-hidden
      />
    </button>
  );
}

// Collapsed record of the steps behind a finished answer. When the answer has
// just streamed, the steps start open and fold shut so nothing jumps.
function WorkedFor({
  ms,
  steps,
  collapseOnMount,
  children,
}: {
  ms: number | undefined;
  steps: number;
  collapseOnMount: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(collapseOnMount);
  useEffect(() => {
    if (!collapseOnMount) return;
    const t = setTimeout(() => setOpen(false), 150);
    return () => clearTimeout(t);
  }, [collapseOnMount]);
  const label = ms ? `Worked for ${formatDuration(ms)}` : "Worked";
  return (
    <div>
      <Disclosure open={open} onToggle={() => setOpen((o) => !o)}>
        <span>{label}</span>
        {steps > 0 && (
          <span className="text-muted-foreground/70 tabular-nums">
            · {steps} {steps === 1 ? "step" : "steps"}
          </span>
        )}
      </Disclosure>
      <Collapse open={open}>
        <div className="mt-2 ml-[5px] space-y-3 border-l pb-1 pl-4">
          {children}
        </div>
      </Collapse>
    </div>
  );
}

// Lictory Intelligence beside its answer, showing what it is doing.
export function AssistantMark({
  mood,
  active,
  failed,
}: {
  mood?: IntelligenceMood;
  active?: boolean;
  failed?: boolean;
}) {
  const done = useAfterglow(!!active);
  return (
    <IntelligenceMark
      mood={mood ?? (failed ? "concerned" : done ? "happy" : undefined)}
      className="size-7 text-primary"
    />
  );
}

// Cell delays of a chevron wave travelling right across a 3×3 grid.
const wave = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  return (i % 3) + Math.abs(row - 1);
});

function PixelLoader() {
  return (
    <span
      aria-hidden
      className="pixel-loader grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
    >
      {wave.map((step, i) => (
        <span
          key={i}
          className="size-1 rounded-[1px] bg-foreground"
          style={{ animationDelay: `${step * 90}ms` }}
        />
      ))}
    </span>
  );
}

function useElapsed() {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const t = setInterval(
      () => setTenths(Math.floor((performance.now() - started) / 100)),
      100,
    );
    return () => clearInterval(t);
  }, []);
  const seconds = tenths / 10;
  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

// The assistant is busy but has nothing to show yet. Short pauses between
// steps stay invisible (`delay`) so the transcript does not flicker.
function Working({ label, delay = 0 }: { label: string; delay?: number }) {
  const [shown, setShown] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  if (!shown) return null;
  return <WorkingLine label={label} />;
}

function WorkingLine({ label }: { label: string }) {
  const elapsed = useElapsed();
  return (
    <div
      role="status"
      className="activity-enter flex h-6 items-center gap-2.5 text-[13px]"
    >
      <PixelLoader />
      <span className="shimmer-text font-medium">{label}</span>
      <span className="font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">
        {elapsed}
      </span>
    </div>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!streaming) return;
    const started = performance.now();
    return () => setSeconds(Math.round((performance.now() - started) / 1000));
  }, [streaming]);
  if (!text && !streaming) return null;
  // Reasoning shows while it streams and settles shut once it is done.
  const expanded = open ?? (streaming && text.length > 0);
  return (
    <div>
      <Disclosure
        open={expanded}
        onToggle={() => setOpen(!expanded)}
        icon={
          <Sparkle
            className={cn(
              "size-3.5 shrink-0 transition-colors",
              streaming && "fill-current text-foreground/70",
            )}
            aria-hidden
          />
        }
      >
        {streaming ? (
          <span className="shimmer-text font-medium">Thinking</span>
        ) : (
          <span>Thought{seconds && seconds > 1 ? ` for ${seconds}s` : ""}</span>
        )}
      </Disclosure>
      {text && (
        <Collapse open={expanded}>
          <p className="mt-1.5 ml-[5px] border-l pl-4 text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
            {text}
          </p>
        </Collapse>
      )}
    </div>
  );
}

// How many recent steps stay visible while a long run is in progress.
const RECENT_STEPS = 5;

// A stretch of consecutive tool calls. While the assistant works the steps
// unfold one by one under a live header; once done they settle into a single
// summary line that opens on demand.
function ActivityGroup({
  activities,
  live,
  onApprove,
}: {
  activities: Activity[];
  live: boolean;
  onApprove: (approvalId: string, approved: boolean) => void;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const current = activities.find((a) => a.running || a.awaiting);
  const attention = activities.some((a) => a.awaiting || a.failed);
  // Steps stay open for the whole live answer, so the list never folds and
  // reopens between one call and the next.
  const expanded = open ?? (live || Boolean(current) || attention);

  if (activities.length === 1 && !live)
    return <ActivityRow activity={activities[0]!} onApprove={onApprove} />;

  const hiddenCount =
    showAll || !(live || current)
      ? 0
      : Math.max(0, activities.length - RECENT_STEPS);
  return (
    <div>
      <Disclosure
        open={expanded}
        onToggle={() => setOpen(!expanded)}
        icon={current ? <Spinner /> : undefined}
      >
        {current ? (
          <span className="min-w-0 truncate">
            <span className="shimmer-text font-medium">
              {current.awaiting
                ? "Waiting for your approval"
                : current.step.running}
            </span>
          </span>
        ) : (
          <span className="tabular-nums">{summarizeSteps(activities)}</span>
        )}
      </Disclosure>
      <Collapse open={expanded}>
        <div className="mt-1 ml-[5px] border-l pb-0.5 pl-3">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="h-7 rounded-md px-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {hiddenCount} earlier {hiddenCount === 1 ? "step" : "steps"}
            </button>
          )}
          {activities.slice(hiddenCount).map((activity) => (
            <ActivityRow
              key={activity.part.toolCallId}
              activity={activity}
              onApprove={onApprove}
            />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/25 border-t-foreground/70 motion-reduce:animate-none",
        className,
      )}
    />
  );
}

function StepGlyph({ activity }: { activity: Activity }) {
  const { step, running, failed, declined, awaiting } = activity;
  if (running) return <Spinner />;
  if (failed) return <AlertTriangle className="size-3.5 text-destructive" />;
  if (declined) return <ShieldX className="size-3.5" />;
  if (awaiting) return <ShieldAlert className="size-3.5 text-warning" />;
  if (step.kind === "search") return <Search className="size-3.5" />;
  if (step.kind === "read") return <FileText className="size-3.5" />;
  return <PenLine className="size-3.5" />;
}

function SubjectChip({ subject }: { subject: Subject }) {
  return (
    <span className="inline-flex h-5.5 min-w-0 items-center gap-1.5 truncate rounded-md bg-muted/70 px-1.5 text-[12px] text-foreground/80 shadow-[inset_0_0_0_1px_var(--border)]">
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

function ActivityRow({
  activity,
  onApprove,
}: {
  activity: Activity;
  onApprove: (approvalId: string, approved: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const { part, step, running, failed, declined, awaiting } = activity;
  const label = running
    ? step.running
    : failed || declined || awaiting
      ? step.action
      : step.done;
  return (
    <div className="activity-enter">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${label}${step.subject ? ` ${subjectText(step.subject)}` : ""}`}
        className="group/step -mx-1 flex h-7 w-[calc(100%+0.5rem)] min-w-0 items-center gap-2 rounded-md px-1 text-left text-[13px] transition-colors duration-100 hover:bg-muted/60"
      >
        <span className="relative grid size-4 shrink-0 place-items-center text-muted-foreground">
          <span
            className={cn(
              "grid place-items-center transition-opacity duration-100 group-hover/step:opacity-0",
              open && "opacity-0",
            )}
          >
            <StepGlyph activity={activity} />
          </span>
          <ChevronDown
            className={cn(
              "absolute size-3.5 opacity-0 transition-[opacity,transform] duration-150 group-hover/step:opacity-100",
              open ? "opacity-100" : "-rotate-90",
            )}
            aria-hidden
          />
        </span>
        <span
          className={cn(
            "shrink-0",
            running
              ? "shimmer-text font-medium"
              : "text-muted-foreground group-hover/step:text-foreground",
            declined && "line-through decoration-muted-foreground/40",
          )}
        >
          {label}
        </span>
        {step.subject && <SubjectChip subject={step.subject} />}
        {declined && (
          <span className="shrink-0 text-[12px] text-muted-foreground">
            Declined
          </span>
        )}
      </button>
      {failed && !open && (
        <p className="mb-1 ml-6 text-[12px] leading-5 text-destructive/80">
          {step.outcome.error}
        </p>
      )}
      <Collapse open={open}>
        <StepDetail activity={activity} />
      </Collapse>
      <AnimatePresence>
        {awaiting &&
          part.state === "approval-requested" &&
          !part.approval.isAutomatic && (
            <ApprovalCard
              title={step.action}
              step={step}
              reason={part.approval.requestReason}
              onDecide={(approved) => onApprove(part.approval.id, approved)}
            />
          )}
      </AnimatePresence>
    </div>
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
      className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/60"
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
    <div className="mt-0.5 mb-1.5 ml-2 space-y-2 border-l py-0.5 pl-3.5 text-[12px]">
      {step.outcome.error && (
        <p className="text-destructive">{step.outcome.error}</p>
      )}
      {step.outcome.summary && (
        <p className="text-muted-foreground">{step.outcome.summary}</p>
      )}
      {items.length > 0 && (
        <div className="-mx-1 grid">
          {items.map((item) => (
            <ItemLink key={item.id ?? item.key} item={item} />
          ))}
        </div>
      )}
      {step.fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {step.fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
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

function Raw({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono leading-4 whitespace-pre-wrap">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ApprovalCard({
  title,
  step,
  reason,
  onDecide,
}: {
  title: string;
  step: Step;
  reason?: string;
  onDecide: (approved: boolean) => void;
}) {
  const [decided, setDecided] = useState(false);
  const decide = (approved: boolean) => {
    setDecided(true);
    onDecide(approved);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
      className="mt-1.5 mb-2 ml-6 max-w-md overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--border),0_8px_24px_-12px_oklch(0_0_0/0.25)]"
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-warning/12 text-warning">
          <ShieldAlert className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">{title}?</p>
          {step.subject && (
            <div className="mt-1 flex">
              <SubjectChip subject={step.subject} />
            </div>
          )}
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            {reason ??
              "This is a decision or cannot be undone easily. It runs as you, only if you approve."}
          </p>
        </div>
      </div>
      {step.fields.length > 0 && (
        <dl className="mx-3.5 mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-2 text-[12px]">
          {step.fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex justify-end gap-1.5 px-3.5 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={decided}
          onClick={() => decide(false)}
          className="rounded-full px-3 active:scale-[0.97]"
        >
          Decline
        </Button>
        <Button
          size="sm"
          disabled={decided}
          onClick={() => decide(true)}
          className="rounded-full px-3 active:scale-[0.97]"
        >
          <ShieldCheck className="size-3.5" /> Approve
        </Button>
      </div>
    </motion.div>
  );
}

// Up to this many changes show as chips; more collapse into one summary line.
const INLINE_CHANGES = 3;

function ChangeContent({ change }: { change: Change }) {
  const item = change.subject.kind === "item" ? change.subject.item : undefined;
  return item ? (
    <>
      <span className="shrink-0 font-mono text-[11px]">{item.key}</span>
      {item.title && <span className="min-w-0 truncate">{item.title}</span>}
    </>
  ) : (
    <span className="min-w-0 truncate">{subjectText(change.subject)}</span>
  );
}

function changeHref(change: Change) {
  return change.subject.kind === "item" ? change.subject.item.href : undefined;
}

// The items this answer changed, kept beside the answer after the steps fold.
function Changes({ changes }: { changes: Change[] }) {
  if (changes.length > INLINE_CHANGES)
    return <ChangeSummary changes={changes} />;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Changes made">
      {changes.map((change, i) => {
        const href = changeHref(change);
        const body = (
          <>
            <Check
              className="size-3 shrink-0 text-success"
              strokeWidth={3}
              aria-hidden
            />
            <span className="shrink-0 text-muted-foreground">
              {change.verb}
            </span>
            <ChangeContent change={change} />
          </>
        );
        const className =
          "activity-enter inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-card px-2 text-[12px] shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.05)]";
        const style = { animationDelay: `${i * 50}ms` };
        return href ? (
          <Link
            key={i}
            href={href}
            className={cn(
              className,
              "transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97]",
            )}
            style={style}
          >
            {body}
          </Link>
        ) : (
          <span key={i} className={className} style={style}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

// Many changes: one line ("Changed 24 items · 20 updated · 4 created") that
// opens a list capped in height, so a bulk action never pushes the answer
// off screen.
function ChangeSummary({ changes }: { changes: Change[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="activity-enter overflow-hidden rounded-lg bg-card text-[12px] shadow-[0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.05)]"
      aria-label="Changes made"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full min-w-0 items-center gap-1.5 px-2.5 text-left transition-colors duration-100 hover:bg-muted/60"
      >
        <Check
          className="size-3 shrink-0 text-success"
          strokeWidth={3}
          aria-hidden
        />
        <span className="shrink-0 font-medium tabular-nums">
          Changed {changes.length} items
        </span>
        <span className="min-w-0 truncate text-muted-foreground tabular-nums">
          · {summarizeChanges(changes)}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <Collapse open={open}>
        <ul className="max-h-60 overflow-y-auto overscroll-contain border-t py-1">
          {changes.map((change, i) => {
            const href = changeHref(change);
            const body = (
              <>
                <span className="w-16 shrink-0 text-muted-foreground">
                  {change.verb}
                </span>
                <ChangeContent change={change} />
              </>
            );
            const className =
              "flex h-7 min-w-0 items-center gap-2 px-2.5 transition-colors duration-100";
            return (
              <li key={i}>
                {href ? (
                  <Link
                    href={href}
                    className={cn(className, "hover:bg-muted/60")}
                  >
                    {body}
                  </Link>
                ) : (
                  <span className={className}>{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      </Collapse>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", duration: 0.25, bounce: 0 }}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </motion.span>
      </AnimatePresence>
    </IconAction>
  );
}

// What the person was looking at when they asked, so later readers know what
// "this" meant.
function SentContext({ context }: { context: ChatContext }) {
  return (
    <div className="flex max-w-[85%] min-w-0 flex-col items-end gap-1">
      <Link
        href={context.page.path}
        className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <LocateFixed className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {context.item
            ? `${context.item.key} · ${context.item.title}`
            : context.page.label}
        </span>
      </Link>
      {context.selection && (
        <blockquote className="line-clamp-3 border-r-2 border-primary/40 pr-2.5 text-right text-[12px] leading-5 text-muted-foreground italic">
          “{context.selection.quote}”
        </blockquote>
      )}
    </div>
  );
}
