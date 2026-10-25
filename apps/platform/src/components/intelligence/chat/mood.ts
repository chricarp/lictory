import { getToolName, isToolUIPart } from "ai";
import type { IntelligenceMood } from "@lictory/ui/intelligence-mark";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type ChatMessage,
} from "@lictory/core/intelligence/chat/shared";

const interactive = new Set<string>([ASK_QUESTIONS, RECOMMEND_ACTION]);

// What Litto's face shows for one answer: asking while a
// question, recommendation or approval waits for the person (even after the
// stream ends), working while the answer is being elaborated, and nothing of
// its own once it is finished.
export function answerMood(
  message: Pick<ChatMessage, "parts">,
  live: boolean,
): IntelligenceMood | undefined {
  const waiting = message.parts.some(
    (p) =>
      isToolUIPart(p) &&
      (p.state === "approval-requested" ||
        (interactive.has(getToolName(p)) && p.state === "input-available")),
  );
  if (waiting) return "asking";
  return live ? "working" : undefined;
}
