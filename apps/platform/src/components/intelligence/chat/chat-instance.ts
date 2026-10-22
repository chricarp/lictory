import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  type ChatMessage,
} from "@lictory/core/intelligence/chat/shared";

// Continue automatically only when the person answered a clarification,
// decided on a recommendation or on approvals, never just because a step
// ended with tool results.
function shouldContinue(options: { messages: UIMessage[] }) {
  if (lastAssistantMessageIsCompleteWithApprovalResponses(options)) return true;
  if (!lastAssistantMessageIsCompleteWithToolCalls(options)) return false;
  const last = options.messages.at(-1);
  if (!last) return false;
  const start = last.parts.findLastIndex((p) => p.type === "step-start");
  return last.parts
    .slice(start + 1)
    .some(
      (p) =>
        p.type === `tool-${ASK_QUESTIONS}` ||
        p.type === `tool-${RECOMMEND_ACTION}`,
    );
}

// One live Intelligence conversation. Only the newest message travels; the
// server's stored transcript is authoritative.
export function createChat(options: {
  id: string;
  organizationId: string;
  surface: "page" | "dock";
  messages?: ChatMessage[];
  onTitle?: (title: string) => void;
  onFinish?: () => void;
}) {
  const { organizationId, surface } = options;
  return new Chat<ChatMessage>({
    id: options.id,
    messages: options.messages ?? [],
    transport: new DefaultChatTransport({
      api: "/api/intelligence/chat",
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: { id, organizationId, surface, message: messages.at(-1) },
      }),
    }),
    sendAutomaticallyWhen: shouldContinue,
    onData: (part) => {
      if (part.type === "data-title") options.onTitle?.(part.data.title);
    },
    onFinish: () => options.onFinish?.(),
  });
}
