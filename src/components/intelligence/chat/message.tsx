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
  Brain,
  Check,
  ChevronRight,
  Copy,
  Eye,
  Loader2,
  PenLine,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { IntelligenceMark } from "~/components/logo";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Markdown } from "~/components/items/markdown";
import { Button } from "~/components/ui/button";
import {
  ASK_QUESTIONS,
  type AskQuestionsInput,
  type AskQuestionsOutput,
  type ChatMessage,
} from "~/intelligence/chat/shared";
import { cn } from "~/lib/utils";
import { AnsweredQuestions, Questionnaire } from "./questionnaire";

type Part = ChatMessage["parts"][number];
type AnyToolPart = ToolUIPart | DynamicToolUIPart;

const ease = [0.23, 1, 0.32, 1] as const;

// "createWorkItem" -> "Create work item".
function humanize(name: string) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const progressive: Record<string, string> = {
  list: "Listing",
  get: "Reading",
  search: "Searching",
  count: "Counting",
  describe: "Inspecting",
  preview: "Previewing",
  create: "Creating",
  update: "Updating",
  archive: "Archiving",
  remove: "Removing",
  delete: "Deleting",
  set: "Setting",
  add: "Adding",
  request: "Requesting",
  reply: "Replying",
  decide: "Deciding",
  merge: "Merging",
  rank: "Ranking",
  reorder: "Reordering",
  start: "Starting",
  complete: "Completing",
  commit: "Committing",
  publish: "Publishing",
  mark: "Marking",
};
const readVerbs = new Set([
  "list",
  "get",
  "search",
  "count",
  "describe",
  "preview",
]);
function toolLabel(name: string, running: boolean) {
  const label = humanize(name);
  const verb = /^[a-z]+/.exec(name)?.[0] ?? "";
  if (!running || !progressive[verb]) return label;
  return `${progressive[verb]}${label.slice(verb.length)}…`;
}

// Tool results are `{ ok, result }` or `{ ok: false, error }` (see agentTools).
function toolFailure(part: AnyToolPart): string | null {
  if (part.state === "output-error") return part.errorText;
  if (part.state !== "output-available") return null;
  const output = part.output as
    { ok?: boolean; error?: { message?: string } } | undefined;
  return output?.ok === false
    ? (output.error?.message ?? "The action failed.")
    : null;
}

// Key fields of a tool input, so people see what an action will change.
function summarize(input: unknown) {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(
      ([k, v]) =>
        v !== null &&
        v !== undefined &&
        v !== "" &&
        !["organizationId", "mutationId"].includes(k),
    )
    .slice(0, 8)
    .map(([k, v]) => [
      humanize(k),
      typeof v === "string"
        ? v.length > 160
          ? `${v.slice(0, 160)}…`
          : v
        : JSON.stringify(v).slice(0, 160),
    ]);
}

export function MessageView({
  message,
  streaming,
  isLast,
  onAnswer,
  onApprove,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
  onAnswer: (toolCallId: string, output: AskQuestionsOutput) => void;
  onApprove: (approvalId: string, approved: boolean) => void;
  onRegenerate?: () => void;
}) {
  const reduce = useReducedMotion();
  // Whether this answer streamed in front of the reader, so its steps fold
  // away visibly when it finishes (history loads already folded).
  const live = streaming && isLast;
  const [sawLive, setSawLive] = useState(live);
  if (live && !sawLive) setSawLive(true);
  if (message.role === "user") {
    const text = message.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n");
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-6 whitespace-pre-wrap">
          {text}
        </div>
      </motion.div>
    );
  }

  // Group consecutive tool calls into one activity timeline.
  const blocks: (
    { kind: "tools"; parts: AnyToolPart[] } | { kind: "part"; part: Part }
  )[] = [];
  for (const part of message.parts) {
    if (isToolUIPart(part) && getToolName(part) !== ASK_QUESTIONS) {
      const prev = blocks.at(-1);
      if (prev?.kind === "tools") prev.parts.push(part);
      else blocks.push({ kind: "tools", parts: [part] });
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
        (getToolName(p) === ASK_QUESTIONS && p.state === "input-available")),
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
  const steps = work.reduce(
    (n, b) => n + (b.kind === "tools" ? b.parts.length : isWork(b) ? 1 : 0),
    0,
  );
  const text = shown
    .flatMap((b) =>
      b.kind === "part" && b.part.type === "text" ? [b.part.text] : [],
    )
    .join("\n\n");
  const hasVisible = message.parts.some(
    (p) => p.type === "text" || p.type === "reasoning" || isToolUIPart(p),
  );

  function renderBlock(block: (typeof blocks)[number], i: number) {
    if (block.kind === "tools")
      return <ToolTimeline key={i} parts={block.parts} onApprove={onApprove} />;
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
            className="chat-prose text-[14px] leading-7 [&_h2]:mt-5 [&_h2]:text-base"
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
        return <Thinking key={i} label="Preparing questions" />;
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
    return null;
  }

  return (
    <div className="group/message flex gap-3">
      <AssistantMark active={streaming && isLast} />
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {!hasVisible && streaming && isLast && <Thinking label="Thinking" />}
        {fold && (
          <WorkedFor
            ms={message.metadata?.workedMs}
            steps={steps}
            collapseOnMount={sawLive && !reduce}
          >
            {work.map((block, i) => renderBlock(block, i))}
          </WorkedFor>
        )}
        {shown.map((block, i) =>
          renderBlock(block, fold ? lastWork + 1 + i : i),
        )}
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
  const [open, setOpen] = useState(false);
  const label = ms ? `Worked for ${formatDuration(ms)}` : "Worked";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        {steps > 0 && (
          <span className="text-muted-foreground/70">
            · {steps} {steps === 1 ? "step" : "steps"}
          </span>
        )}
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      <motion.div
        initial={collapseOnMount ? { height: "auto", opacity: 1 } : false}
        animate={
          open ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }
        }
        transition={{
          duration: open ? 0.3 : 0.45,
          ease,
          delay: collapseOnMount && !open ? 0.15 : 0,
        }}
        className="overflow-hidden"
        inert={!open}
      >
        <div className="mt-2 space-y-3 border-l-2 pl-3">{children}</div>
      </motion.div>
    </div>
  );
}

export function AssistantMark({ active }: { active?: boolean }) {
  return (
    <div className="relative mt-0.5 grid size-7 shrink-0 place-items-center">
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,var(--primary),oklch(0.7_0.2_320),oklch(0.75_0.15_200),var(--primary))] opacity-90",
          active && "animate-[spin_2.4s_linear_infinite]",
        )}
      />
      <span className="absolute inset-[1.5px] rounded-full bg-background" />
      <IntelligenceMark className="relative size-3.5 text-primary" />
    </div>
  );
}

export function Thinking({ label }: { label: string }) {
  return (
    <p className="shimmer-text text-[13px] font-medium" aria-live="polite">
      {label}…
    </p>
  );
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const started = useRef(0);
  useEffect(() => {
    started.current = Date.now();
  }, []);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!streaming && seconds === null)
      setSeconds(
        Math.max(1, Math.round((Date.now() - started.current) / 1000)),
      );
  }, [streaming, seconds]);
  if (!text && !streaming) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <Brain className="size-3.5" aria-hidden />
        {streaming ? (
          <span className="shimmer-text font-medium">Reasoning…</span>
        ) : (
          <span>Thought{seconds ? ` for ${seconds}s` : ""}</span>
        )}
        <ChevronRight
          className={cn(
            "size-3.5 transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && text && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease }}
            className="overflow-hidden"
          >
            <p className="mt-2 border-l-2 pl-3 text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
              {text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolTimeline({
  parts,
  onApprove,
}: {
  parts: AnyToolPart[];
  onApprove: (approvalId: string, approved: boolean) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <ol className="relative space-y-1">
      {parts.length > 1 && (
        <span
          aria-hidden
          className="absolute top-3 bottom-3 left-[9px] w-px bg-border"
        />
      )}
      {parts.map((part) => (
        <motion.li
          key={part.toolCallId}
          initial={reduce ? false : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, ease }}
          className="relative"
        >
          <ToolStep part={part} onApprove={onApprove} />
        </motion.li>
      ))}
    </ol>
  );
}

function ToolStep({
  part,
  onApprove,
}: {
  part: AnyToolPart;
  onApprove: (approvalId: string, approved: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const name = getToolName(part);
  const read = readVerbs.has(/^[a-z]+/.exec(name)?.[0] ?? "");
  const running =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "approval-responded" && part.approval.approved);
  const failure = toolFailure(part);
  const denied =
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved);
  const awaiting = part.state === "approval-requested";

  const icon = running ? (
    <Loader2 className="size-3 animate-spin" />
  ) : failure ? (
    <AlertTriangle className="size-3" />
  ) : denied ? (
    <ShieldX className="size-3" />
  ) : awaiting ? (
    <ShieldAlert className="size-3" />
  ) : read ? (
    <Eye className="size-3" />
  ) : (
    <Check className="size-3" strokeWidth={3} />
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group/tool flex w-full items-center gap-2 rounded-md py-1 text-left text-[13px]"
      >
        <span
          className={cn(
            "relative z-10 grid size-[19px] shrink-0 place-items-center rounded-full border bg-background transition-colors",
            failure && "border-destructive/40 text-destructive",
            denied && "text-muted-foreground",
            awaiting && "border-warning/50 text-warning",
            !failure &&
              !denied &&
              !awaiting &&
              !running &&
              !read &&
              "border-success/40 bg-success/10 text-success",
            (running || read) && !failure && "text-muted-foreground",
          )}
        >
          {icon}
        </span>
        {!read && !running && !failure && !denied && !awaiting && (
          <PenLine className="size-3 text-muted-foreground" aria-hidden />
        )}
        <span
          className={cn(
            "min-w-0 truncate",
            running
              ? "shimmer-text font-medium"
              : "text-muted-foreground group-hover/tool:text-foreground",
            failure && "text-destructive",
          )}
        >
          {toolLabel(name, running)}
          {denied && " — declined"}
        </span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground opacity-0 transition-[transform,opacity] duration-200 group-hover/tool:opacity-100",
            open && "rotate-90 opacity-100",
          )}
          aria-hidden
        />
      </button>
      {failure && !open && (
        <p className="ml-7 text-[12px] text-destructive/90">{failure}</p>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-7 grid gap-2 rounded-lg border bg-muted/30 p-2 text-[11px]">
              <Inspect label="Input" value={part.input} />
              {part.state === "output-available" && (
                <Inspect label="Result" value={part.output} />
              )}
              {part.state === "output-error" && (
                <Inspect label="Error" value={part.errorText} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {awaiting && !part.approval.isAutomatic && (
          <ApprovalCard
            name={name}
            input={part.input}
            reason={part.approval.requestReason}
            onDecide={(approved) => onApprove(part.approval.id, approved)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Inspect({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-56 overflow-auto rounded bg-background p-2 font-mono leading-4 whitespace-pre-wrap">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function ApprovalCard({
  name,
  input,
  reason,
  onDecide,
}: {
  name: string;
  input: unknown;
  reason?: string;
  onDecide: (approved: boolean) => void;
}) {
  const [decided, setDecided] = useState(false);
  const fields = summarize(input);
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
      className="mt-2 ml-7 overflow-hidden rounded-xl border border-warning/30 bg-card shadow-[0_8px_30px_-16px_oklch(0_0_0/0.25)]"
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-warning"
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Approve “{humanize(name)}”?</p>
          <p className="text-[12px] text-muted-foreground">
            {reason ??
              "This is a decision or cannot be undone easily. It runs as you, only if you approve."}
          </p>
        </div>
      </div>
      {fields.length > 0 && (
        <dl className="mx-3 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/40 p-2 text-[12px]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex justify-end gap-2 p-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={decided}
          onClick={() => decide(false)}
        >
          <ShieldX className="size-3.5" /> Decline
        </Button>
        <Button size="sm" disabled={decided} onClick={() => decide(true)}>
          <ShieldCheck className="size-3.5" /> Approve
        </Button>
      </div>
    </motion.div>
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
