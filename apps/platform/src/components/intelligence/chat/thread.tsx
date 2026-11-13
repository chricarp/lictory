import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  useAfterglow,
  type IntelligenceMood,
} from "@lictory/ui/intelligence-mark";
import { Button } from "@lictory/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@lictory/ui/ai/item";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
} from "@lictory/ui/ai/message-scroller";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
} from "@lictory/core/intelligence/chat/shared";
import { cn } from "@lictory/core/lib/utils";
import type { LittoChat } from "@lictory/platform/components/intelligence/chat/chat-instance";
import {
  MessageView,
  type MessageHandlers,
} from "@lictory/platform/components/intelligence/chat/message";
import { answerMood } from "@lictory/platform/components/intelligence/chat/mood";

// One live conversation as the page and the dock both show it. Messages and
// run status come from the saved snapshot the client polls while subscribed.
export function useThread(chat: LittoChat) {
  const state = useSyncExternalStore(
    chat.subscribe,
    chat.getSnapshot,
    chat.getSnapshot,
  );
  const busy = state.status === "submitted" || state.status === "streaming";
  // A clarification, recommendation or approval waits for the person: the
  // composer pauses until they answer it.
  const pendingQuestion = !!state.messages
    .at(-1)
    ?.parts.some(
      (p) =>
        "state" in p &&
        (p.state === "approval-requested" ||
          ((p.type === `tool-${ASK_QUESTIONS}` ||
            p.type === `tool-${RECOMMEND_ACTION}`) &&
            p.state === "input-available")),
    );

  return {
    ...state,
    busy,
    pendingQuestion,
    sendMessage: chat.sendMessage,
    stop: chat.stop,
    regenerate: chat.regenerate,
    addToolOutput: chat.addToolOutput,
    addToolApprovalResponse: chat.addToolApprovalResponse,
    clearError: chat.clearError,
  };
}
export type Thread = ReturnType<typeof useThread>;

export type ChatActivity =
  "working" | "waiting" | "failed" | "completed" | "canceled";

// Litto's expression for a conversation as a whole: what its
// latest answer is doing, then how the last one ended.
export function useThreadMood(thread: Thread): IntelligenceMood {
  const done = useAfterglow(thread.busy);
  const last = thread.messages.at(-1);
  const answering =
    last?.role === "assistant" ? answerMood(last, thread.busy) : undefined;
  if (answering) return answering;
  if (thread.busy) return "working";
  if (thread.error) return "concerned";
  return done ? "happy" : "idle";
}

// The conversation (Chat, AI Elements): each turn is a row of a Message
// Scroller, the person's message anchors its turn near the top, and the reply
// streams into the room below it. The caller owns the
// MessageScrollerProvider, so the composer can use the same scroller.
export function Transcript({
  thread,
  top,
  onEdit,
  onFollowUp,
  cancelInTranscript,
  onPromptAnswered,
  className,
  contentClassName,
}: {
  thread: Thread;
  top?: ReactNode;
  onEdit?: (text: string) => void;
  onFollowUp?: (text: string) => void;
  // Called when a question, recommendation or approval was answered, so
  // focus can return to the composer instead of the page.
  onPromptAnswered?: () => void;
  // Without a composer (Litto unavailable) the transcript offers to cancel a
  // turn that waits for an answer; otherwise the composer does.
  cancelInTranscript?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const {
    messages,
    status,
    error,
    busy,
    canRetry,
    regenerate,
    addToolOutput,
    addToolApprovalResponse,
    clearError,
    pendingQuestion,
    stop,
  } = thread;
  const handlers = (i: number): MessageHandlers => ({
    onAnswer: (toolCallId, output) =>
      settle(addToolOutput({ tool: ASK_QUESTIONS, toolCallId, output })),
    onDecide: (toolCallId, output) =>
      settle(addToolOutput({ tool: RECOMMEND_ACTION, toolCallId, output })),
    onApprove: (approvalId, approved) =>
      settle(addToolApprovalResponse({ id: approvalId, approved })),
    // A failed turn offers Retry beside its error instead.
    onRegenerate:
      i === messages.length - 1 && !busy && canRetry && !error
        ? () => void regenerate()
        : undefined,
    onEdit,
    onFollowUp,
  });
  const pending = status === "submitted" && messages.at(-1)?.role === "user";
  const waited = useRef(pendingQuestion);
  useEffect(() => {
    if (waited.current && !pendingQuestion) onPromptAnswered?.();
    waited.current = pendingQuestion;
  }, [pendingQuestion, onPromptAnswered]);
  // What changed, said once and politely; the transcript's own log does not
  // read streamed text token by token.
  const announcement = error
    ? ""
    : pendingQuestion && !busy
      ? "Litto is waiting for your response."
      : busy
        ? "Litto is working."
        : messages.at(-1)?.role === "assistant"
          ? finished(messages.at(-1)!)
          : "";
  return (
    <MessageScroller className={className}>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <MessageScrollerViewport>
        <MessageScrollerContent
          aria-busy={busy}
          className={cn(
            "mx-auto w-full max-w-3xl px-4 pt-6 pb-8",
            contentClassName,
          )}
        >
          {top && (
            <MessageScrollerItem messageId="litto-top">
              {top}
            </MessageScrollerItem>
          )}
          {messages.map((message, i) => (
            <MessageScrollerItem
              key={message.id}
              messageId={message.id}
              scrollAnchor={message.role === "user"}
            >
              <MessageView
                message={message}
                streaming={busy}
                isLast={i === messages.length - 1}
                failed={!!error && i === messages.length - 1}
                handlers={handlers(i)}
              />
            </MessageScrollerItem>
          ))}
          {pending && (
            <MessageScrollerItem messageId="litto-pending">
              <MessageView
                message={{ id: "pending", role: "assistant", parts: [] }}
                streaming
                isLast
                handlers={handlers(-1)}
              />
            </MessageScrollerItem>
          )}
          {cancelInTranscript && pendingQuestion && !busy && (
            <MessageScrollerItem messageId="litto-cancel">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void stop().catch(() => undefined)}
              >
                Cancel this turn
              </Button>
            </MessageScrollerItem>
          )}
          {error && (
            <MessageScrollerItem messageId="litto-error">
              <Item
                variant="destructive"
                role="alert"
                size="sm"
                // Aligned with the reply it ended, beside Litto's mark.
                className="w-auto sm:ml-10"
              >
                <ItemMedia className="text-destructive" aria-hidden>
                  <AlertTriangle className="size-4" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Litto stopped before finishing</ItemTitle>
                  <ItemDescription className="text-foreground/80">
                    {readableError(error)}
                  </ItemDescription>
                </ItemContent>
                {canRetry && (
                  <ItemActions>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        clearError();
                        void regenerate();
                      }}
                    >
                      <RotateCcw className="size-3.5" aria-hidden /> Retry
                    </Button>
                  </ItemActions>
                )}
              </Item>
            </MessageScrollerItem>
          )}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  );
}

// The outcome of a finished turn, said once: a failed step is part of it.
function finished(message: Thread["messages"][number]) {
  const failed = message.parts.filter(
    (part) =>
      "state" in part &&
      (part.state === "output-error" ||
        (part.state === "output-available" &&
          "output" in part &&
          (part.output as { ok?: unknown } | undefined)?.ok === false)),
  ).length;
  return failed
    ? `Litto finished; ${failed} ${failed === 1 ? "step" : "steps"} did not complete.`
    : "Litto finished.";
}

// A response that fails surfaces as the conversation's error (with Retry);
// the card only needs to know it is no longer in flight.
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    () => undefined,
  );

function readableError(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as {
      error?: { message?: string };
    };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON: already a message.
  }
  return error.message || "The assistant stopped unexpectedly. Try again.";
}
