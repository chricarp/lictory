import { useChat, type Chat } from "@ai-sdk/react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  useAfterglow,
  type IntelligenceMood,
} from "@lictory/ui/intelligence-mark";
import { Button } from "@lictory/ui/button";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type ChatMessage,
} from "@lictory/core/intelligence/chat/shared";
import { MessageView } from "@lictory/platform/components/intelligence/chat/message";
import { answerMood } from "@lictory/platform/components/intelligence/chat/mood";

// One live conversation as the page and the dock both show it.
export function useThread(chat: Chat<ChatMessage>) {
  const state = useChat<ChatMessage>({ chat, experimental_throttle: 40 });
  const busy = state.status === "submitted" || state.status === "streaming";
  // A clarification or recommendation waits for the person: the composer
  // pauses until they answer it.
  const pendingQuestion = !!state.messages
    .at(-1)
    ?.parts.some(
      (p) =>
        (p.type === `tool-${ASK_QUESTIONS}` ||
          p.type === `tool-${RECOMMEND_ACTION}`) &&
        "state" in p &&
        p.state === "input-available",
    );
  return { ...state, busy, pendingQuestion };
}
export type Thread = ReturnType<typeof useThread>;

// Lictory Intelligence's expression for a conversation as a whole: what its
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

export function ThreadMessages({ thread }: { thread: Thread }) {
  const {
    messages,
    status,
    error,
    busy,
    regenerate,
    addToolOutput,
    addToolApprovalResponse,
    clearError,
  } = thread;
  return (
    <>
      {messages.map((message, i) => (
        <MessageView
          key={message.id}
          message={message}
          streaming={busy}
          isLast={i === messages.length - 1}
          failed={!!error && i === messages.length - 1}
          onAnswer={(toolCallId, output) =>
            void addToolOutput({
              tool: ASK_QUESTIONS as never,
              toolCallId,
              output,
            })
          }
          onDecide={(toolCallId, output) =>
            void addToolOutput({
              tool: RECOMMEND_ACTION as never,
              toolCallId,
              output,
            })
          }
          onApprove={(approvalId, approved) =>
            void addToolApprovalResponse({ id: approvalId, approved })
          }
          onRegenerate={
            i === messages.length - 1 && !busy
              ? () => void regenerate()
              : undefined
          }
        />
      ))}
      {status === "submitted" && messages.at(-1)?.role === "user" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <MessageView
            message={{ id: "pending", role: "assistant", parts: [] }}
            streaming
            isLast
            onAnswer={() => undefined}
            onDecide={() => undefined}
            onApprove={() => undefined}
          />
        </motion.div>
      )}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]"
            role="alert"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <p className="min-w-0 flex-1">{readableError(error)}</p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearError();
                void regenerate();
              }}
            >
              <RotateCcw className="size-3.5" /> Retry
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

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
