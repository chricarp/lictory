import { getToolName, isToolUIPart } from "ai";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Copy,
  LocateFixed,
  MoreHorizontal,
  PenLine,
  RotateCcw,
} from "lucide-react";
import { Link } from "@lictory/platform/lib/navigation";
import {
  IntelligenceMark,
  useAfterglow,
  type IntelligenceMood,
} from "@lictory/ui/intelligence-mark";
import { Fragment, memo, useState, type ReactNode } from "react";
import {
  Bubble,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@lictory/ui/ai/message";
import { Trace } from "@lictory/ui/ai/trace";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type AskQuestionsInput,
  type AskQuestionsOutput,
  type ChatContext,
  type ChatMessage,
  type RecommendActionInput,
  type RecommendActionOutput,
} from "@lictory/core/intelligence/chat/shared";
import type { Insights } from "@lictory/core/intelligence/insights";
import { cn } from "@lictory/core/lib/utils";
import {
  changesOf,
  findKnown,
} from "@lictory/platform/components/intelligence/chat/activity";
import { InsightCards } from "@lictory/platform/components/intelligence/chat/insights";
import { answerMood } from "@lictory/platform/components/intelligence/chat/mood";
import {
  AnsweredQuestions,
  Questionnaire,
} from "@lictory/platform/components/intelligence/chat/questionnaire";
import {
  DecidedRecommendation,
  RecommendationCard,
} from "@lictory/platform/components/intelligence/chat/recommendation";
import { Response } from "@lictory/platform/components/intelligence/chat/response";
import {
  activityOf,
  Changes,
  Confirmation,
  Failures,
  ReasoningStep,
  Sources,
  StepLines,
  ThinkingLine,
  WorkSummary,
  type Activity,
} from "@lictory/platform/components/intelligence/chat/steps";
import { useLookup } from "@lictory/platform/components/intelligence/chat/use-lookup";

type Part = ChatMessage["parts"][number];
// Tools answered by the person in the chat rather than run on the server.
const interactive = new Set<string>([ASK_QUESTIONS, RECOMMEND_ACTION]);

type Block =
  { kind: "tools"; activities: Activity[] } | { kind: "part"; part: Part };

function insightsOf(activities: Activity[]): Insights[] {
  return activities.flatMap((a) =>
    getToolName(a.part) === "getInsights" &&
    a.part.state === "output-available" &&
    !a.failed
      ? [(a.part.output as { result: Insights }).result]
      : [],
  );
}

const isText = (b: Block) =>
  b.kind === "part" && b.part.type === "text" && b.part.text.trim() !== "";
const isWork = (b: Block) =>
  b.kind === "tools" || b.part.type === "reasoning" || isToolUIPart(b.part);

// Each response resolves once it is sent or has failed; a card that is
// still on screen afterwards was not applied and takes input again.
export type MessageHandlers = {
  onAnswer: (toolCallId: string, output: AskQuestionsOutput) => Promise<void>;
  onDecide: (
    toolCallId: string,
    output: RecommendActionOutput,
  ) => Promise<void>;
  onApprove: (approvalId: string, approved: boolean) => Promise<void>;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
  // Adds a follow-up to the composer, keeping what the person already wrote.
  onFollowUp?: (text: string) => void;
};

type MessageViewProps = {
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
  failed?: boolean;
  handlers: MessageHandlers;
};

// A turn re-renders only when it changed: the chat keeps unchanged messages'
// identity across snapshots, and handlers call stable chat methods, so only
// which actions are offered matters.
export const MessageView = memo(
  MessageViewImpl,
  (a: MessageViewProps, b: MessageViewProps) =>
    a.message === b.message &&
    a.streaming === b.streaming &&
    a.isLast === b.isLast &&
    a.failed === b.failed &&
    !!a.handlers.onRegenerate === !!b.handlers.onRegenerate &&
    !!a.handlers.onEdit === !!b.handlers.onEdit &&
    !!a.handlers.onFollowUp === !!b.handlers.onFollowUp,
);

function MessageViewImpl({
  message,
  streaming,
  isLast,
  failed,
  handlers,
}: MessageViewProps) {
  if (message.role === "user")
    return <UserMessage message={message} onEdit={handlers.onEdit} />;
  return (
    <AssistantMessage
      message={message}
      live={streaming && isLast}
      streaming={streaming}
      isLast={isLast}
      failed={failed}
      handlers={handlers}
    />
  );
}

function UserMessage({
  message,
  onEdit,
}: {
  message: ChatMessage;
  onEdit?: (text: string) => void;
}) {
  const text = message.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n");
  const context = message.parts.find((p) => p.type === "data-context")?.data;
  const [actions, setActions] = useState(false);
  return (
    <Message align="end">
      <MessageContent className="gap-1.5">
        {context && <SentContext context={context} />}
        {/* Actions sit beside the bubble on hover or focus, taking no room
            of their own, so the reply follows the question directly. */}
        <div className="relative w-fit max-w-[min(85%,40rem)] self-end">
          {/* On touch, the actions open from one button beside the bubble,
              so a phone does not spend a row on every question. */}
          <Bubble variant="muted" className="max-w-full">
            {text}
          </Bubble>
          <button
            type="button"
            aria-label="Message actions"
            aria-expanded={actions}
            onClick={() => setActions((open) => !open)}
            className="absolute top-1/2 right-full mr-1 hidden size-11 -translate-y-1/2 place-items-center rounded-md text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none touch:grid"
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
          <MessageFooter
            className={cn(
              "absolute top-1/2 right-full mt-0 mr-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-focus-within/message:opacity-100 group-hover/message:opacity-100 touch:static touch:mt-1 touch:mr-0 touch:translate-y-0 touch:justify-end touch:opacity-100",
              !actions && "touch:hidden",
            )}
          >
            <CopyAction text={text} />
            {onEdit && (
              <Action label="Edit in the composer" onClick={() => onEdit(text)}>
                <PenLine className="size-3.5" />
              </Action>
            )}
          </MessageFooter>
        </div>
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({
  message,
  live,
  streaming,
  isLast,
  failed,
  handlers,
}: {
  message: ChatMessage;
  live: boolean;
  streaming: boolean;
  isLast: boolean;
  failed?: boolean;
  handlers: MessageHandlers;
}) {
  const lookup = useLookup();
  // Whether this answer streamed in front of the reader, so its steps fold
  // away visibly when it finishes (history loads already folded).
  const [sawLive, setSawLive] = useState(live);
  if (live && !sawLive) setSawLive(true);
  // A call still in flight on an earlier turn, or on a turn that failed,
  // never finished.
  const interrupted = !live && (!isLast || !!failed);

  // Consecutive tool calls form one stretch of activity.
  const blocks: Block[] = [];
  for (const part of message.parts) {
    if (part.type === "step-start") continue;
    // Consecutive reasoning (a model may send several summaries) reads as
    // one line of thinking.
    const prev = blocks.at(-1);
    if (
      part.type === "reasoning" &&
      prev?.kind === "part" &&
      prev.part.type === "reasoning"
    ) {
      prev.part = {
        ...prev.part,
        text: [prev.part.text, part.text].filter(Boolean).join("\n\n"),
        state: part.state,
      };
      continue;
    }
    if (isToolUIPart(part) && !interactive.has(getToolName(part))) {
      const activity = activityOf(part, lookup, interrupted);
      const prev = blocks.at(-1);
      if (prev?.kind === "tools") prev.activities.push(activity);
      else blocks.push({ kind: "tools", activities: [activity] });
    } else blocks.push({ kind: "part", part });
  }
  const activities = blocks.flatMap((b) =>
    b.kind === "tools" ? b.activities : [],
  );
  const waiting = message.parts.some(
    (p) =>
      isToolUIPart(p) &&
      (p.state === "approval-requested" ||
        (interactive.has(getToolName(p)) && p.state === "input-available")),
  );
  // Once the answer is complete, the work that led to it folds behind one
  // line, leaving the answer. Anything waiting for the person stays open.
  const lastWork = blocks.findLastIndex(isWork);
  const answer = blocks.slice(lastWork + 1);
  const fold =
    !live && !waiting && lastWork >= 0 && answer.some((b) => isText(b));
  const work = fold ? blocks.slice(0, lastWork + 1) : [];
  const shown = fold ? answer : blocks;
  const changes = live ? [] : changesOf(activities);
  const pagesRead = !live
    ? [
        ...new Map(
          activities
            .filter((a) => a.done && getToolName(a.part) === "getPage")
            .flatMap((a) => a.step.outcome.pages ?? [])
            .map((p) => [`${p.pageId}@${p.commitId ?? ""}`, p] as const),
        ).values(),
      ]
    : [];
  const foldedInsights = fold ? insightsOf(activities) : [];
  const text = shown
    .flatMap((b) =>
      b.kind === "part" && b.part.type === "text" ? [b.part.text] : [],
    )
    .join("\n\n");
  // Between steps the model is deciding what to do next; say so instead of
  // leaving the last finished step looking like the end.
  const visible = blocks.filter(
    (b) => b.kind === "tools" || isText(b) || isWork(b),
  );
  const tail = visible.at(-1);
  const pausing =
    live &&
    !waiting &&
    (!tail ||
      (tail.kind === "tools" &&
        !tail.activities.some((a) => a.running || a.awaiting)) ||
      (tail.kind === "part" &&
        tail.part.type === "reasoning" &&
        tail.part.state !== "streaming"));
  const lastText = blocks.findLastIndex(isText);
  const unverified =
    fold &&
    activities.some((a) => a.failed && a.step.kind === "write") &&
    text.trim() !== "";
  const readOutputs = activities.flatMap((a) =>
    a.part.state === "output-available" ? [a.part.output] : [],
  );
  // Text the reader saw stream in. A turn that fails keeps only its
  // completed steps on the server, so what was shown but not saved stays on
  // screen, marked as incomplete, instead of vanishing.
  const [seenText, setSeenText] = useState("");
  if (live && text.length > seenText.length) setSeenText(text);
  const lost =
    failed && !live && seenText.trim() && !text.startsWith(seenText.trim())
      ? seenText
      : null;

  // Each block becomes lines of the trace or a block of its own; lines that
  // follow each other share one Trace.
  type Node = { line: boolean; key: string; node: ReactNode };
  const nodes = (list: Block[], offset: number, inFold: boolean): Node[] =>
    list.flatMap((block, j): Node[] => {
      const i = offset + j;
      if (block.kind === "tools") {
        // A call waiting for approval is the card below, not a line.
        const lines = block.activities.filter(
          (a) =>
            !(
              a.awaiting &&
              a.part.state === "approval-requested" &&
              !a.part.approval.isAutomatic
            ),
        );
        const out: Node[] = lines.length
          ? [
              {
                line: true,
                key: `t${i}`,
                node: (
                  <StepLines
                    key={`t${i}`}
                    activities={lines}
                    live={live}
                    quiet={inFold || !live}
                  />
                ),
              },
            ]
          : [];
        for (const a of block.activities)
          if (
            a.awaiting &&
            a.part.state === "approval-requested" &&
            !a.part.approval.isAutomatic
          ) {
            const approvalId = a.part.approval.id;
            out.push({
              line: false,
              key: `a${a.part.toolCallId}`,
              node: (
                <Confirmation
                  key={`a${a.part.toolCallId}`}
                  activity={a}
                  known={(id) => findKnown(readOutputs, id)}
                  onDecide={(approved) =>
                    handlers.onApprove(approvalId, approved)
                  }
                />
              ),
            });
          }
        const reports = inFold ? [] : insightsOf(block.activities);
        if (reports.length)
          out.push({
            line: false,
            key: `i${i}`,
            node: <InsightCards key={`i${i}`} reports={reports} />,
          });
        return out;
      }
      const part = block.part;
      if (part.type === "text") {
        if (!part.text.trim()) return [];
        return [
          {
            line: false,
            key: `x${i}`,
            node: (
              <div
                key={`x${i}`}
                className={cn(inFold && "text-muted-foreground")}
              >
                <Response
                  text={part.text}
                  streaming={
                    live && i === lastText && part.state === "streaming"
                  }
                />
              </div>
            ),
          },
        ];
      }
      if (part.type === "reasoning")
        return [
          {
            line: true,
            key: `r${i}`,
            node: (
              <ReasoningStep
                key={`r${i}`}
                text={part.text}
                streaming={live && part.state === "streaming"}
              />
            ),
          },
        ];
      if (isToolUIPart(part) && getToolName(part) === ASK_QUESTIONS) {
        const input = part.input as AskQuestionsInput | undefined;
        if (part.state === "input-streaming" || !input?.questions)
          return [
            {
              line: true,
              key: `q${i}`,
              node: <ThinkingLine key={`q${i}`} label="Preparing questions" />,
            },
          ];
        if (part.state === "output-available")
          return [
            {
              line: true,
              key: `q${i}`,
              node: (
                <AnsweredQuestions
                  key={`q${i}`}
                  input={input}
                  output={part.output as AskQuestionsOutput}
                />
              ),
            },
          ];
        if (part.state === "input-available")
          return [
            {
              line: false,
              key: part.toolCallId,
              node: (
                <Questionnaire
                  key={part.toolCallId}
                  input={input}
                  onSubmit={(output) =>
                    handlers.onAnswer(part.toolCallId, output)
                  }
                />
              ),
            },
          ];
      }
      if (isToolUIPart(part) && getToolName(part) === RECOMMEND_ACTION) {
        const input = part.input as RecommendActionInput | undefined;
        if (part.state === "input-streaming" || !input?.question)
          return [
            {
              line: true,
              key: `c${i}`,
              node: (
                <ThinkingLine
                  key={`c${i}`}
                  label="Preparing a recommendation"
                />
              ),
            },
          ];
        if (part.state === "output-available")
          return [
            {
              line: true,
              key: `c${i}`,
              node: (
                <DecidedRecommendation
                  key={`c${i}`}
                  input={input}
                  output={part.output as RecommendActionOutput}
                />
              ),
            },
          ];
        if (part.state === "input-available")
          return [
            {
              line: false,
              key: part.toolCallId,
              node: (
                <RecommendationCard
                  key={part.toolCallId}
                  input={input}
                  onDecide={(output) =>
                    handlers.onDecide(part.toolCallId, output)
                  }
                />
              ),
            },
          ];
      }
      return [];
    });

  const shownNodes = nodes(shown, fold ? lastWork + 1 : 0, false);
  if (pausing)
    shownNodes.push({
      line: true,
      key: `pause${visible.length}`,
      node: (
        <ThinkingLine key={`pause${visible.length}`} delay={tail ? 450 : 0} />
      ),
    });

  return (
    <Message>
      {/* Phones give the reply the full width; the mark sits in the header. */}
      <MessageAvatar className="max-sm:hidden">
        <AssistantMark
          mood={answerMood(message, live)}
          active={live}
          failed={failed}
        />
      </MessageAvatar>
      <MessageContent className="gap-3 pt-0.5">
        {fold && (
          <Trace>
            <WorkSummary
              ms={message.metadata?.workedMs}
              steps={
                activities.length +
                work.filter((b) => b.kind === "part" && isWork(b)).length
              }
              changes={changes.length}
              failed={activities.filter((a) => a.failed).length}
              watched={sawLive}
            >
              {nodes(work, 0, true).map((n) => n.node)}
            </WorkSummary>
          </Trace>
        )}
        {foldedInsights.length > 0 && <InsightCards reports={foldedInsights} />}
        {/* What actually failed leads the reply: the verified outcome comes
            before the model's own account of it. */}
        {!live && activities.some((a) => a.failed) && (
          <Failures
            activities={activities.filter((a) => a.failed)}
            onFollowUp={handlers.onFollowUp}
          />
        )}
        {unverified ? (
          // A step failed: the model's own account is set apart and marked,
          // the box above is the verified outcome. The text is unchanged.
          <div className="flex flex-col gap-3 border-l-2 border-warning/45 pl-3.5">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <AlertTriangle
                className="size-3 shrink-0 text-warning"
                aria-hidden
              />
              Written by Litto after a step failed; it may not match what
              happened above
            </p>
            {group(shownNodes)}
          </div>
        ) : (
          group(shownNodes)
        )}
        {lost && (
          <div className="rounded-xl border border-dashed px-3.5 py-2.5">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">
              Incomplete · not saved, Litto stopped while writing this
            </p>
            <div className="text-muted-foreground">
              <Response text={lost} streaming={false} />
            </div>
          </div>
        )}
        {(pagesRead.length > 0 || changes.length > 0) && (
          <div className="flex flex-col gap-1.5">
            {pagesRead.length > 0 && (
              <Trace>
                <Sources pages={pagesRead} />
              </Trace>
            )}
            {changes.length > 0 && <Changes changes={changes} />}
          </div>
        )}
        {!streaming && !waiting && text && (
          <MessageFooter
            className={cn(
              "-ml-1.5 transition-opacity duration-150",
              !isLast &&
                "opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100 touch:opacity-100",
            )}
          >
            <CopyAction
              text={
                unverified
                  ? `[Written by Litto after a step failed: ${activities
                      .filter((a) => a.failed)
                      .map((a) => a.step.action)
                      .join(", ")}. It may not match what happened.]\n\n${text}`
                  : text
              }
            />
            {isLast && handlers.onRegenerate && (
              <Action label="Retry" onClick={handlers.onRegenerate}>
                <RotateCcw className="size-3.5" />
              </Action>
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

// Lines that follow each other share one Trace, so their spacing and
// indentation line up; everything else stands on its own.
function group(nodes: { line: boolean; key: string; node: ReactNode }[]) {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  let runKey = "";
  const flush = () => {
    if (run.length) out.push(<Trace key={`trace-${runKey}`}>{run}</Trace>);
    run = [];
  };
  for (const n of nodes) {
    if (n.line) {
      if (!run.length) runKey = n.key;
      run.push(n.node);
    } else {
      flush();
      out.push(<Fragment key={n.key}>{n.node}</Fragment>);
    }
  }
  flush();
  return out;
}

// Litto beside its answer, showing what it is doing.
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
      className="size-6 text-primary"
    />
  );
}

function Action({
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
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none touch:size-11"
    >
      {children}
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Action
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
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
    </Action>
  );
}

// What the person was looking at when they asked, so later readers know what
// "this" meant.
function SentContext({ context }: { context: ChatContext }) {
  const quote =
    context.selection?.quote ?? context.document?.selection?.quote ?? null;
  return (
    <div className="flex max-w-[min(85%,40rem)] min-w-0 flex-col items-end gap-1">
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
      {quote && <SentQuote quote={quote} />}
    </div>
  );
}

// The passage the person asked about: three lines, the rest one click away.
function SentQuote({ quote }: { quote: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="cursor-pointer rounded-sm text-right outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <blockquote
        className={cn(
          "border-r-2 border-primary/40 pr-2.5 text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground italic select-text",
          !open && "line-clamp-3",
        )}
      >
        “{quote}”
      </blockquote>
    </button>
  );
}
