import {
  convertToModelMessages,
  isStepCount,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
  type LanguageModel,
} from "ai";
import {
  CapabilityError,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import type { Directory } from "@lictory/core/contracts/protocol";
import {
  assistantTools,
  chatModel,
  systemPrompt,
} from "@lictory/core/intelligence/chat/assistant";
import {
  contextPrompt,
  type ChatMessage,
} from "@lictory/core/intelligence/chat/shared";
import type { ChatOwner } from "@lictory/core/intelligence/chat/runs";

export type ChatGenerator = (input: {
  messages: ChatMessage[];
  roster: Directory;
  owner: ChatOwner;
  ctx: CapabilityContext;
  signal: AbortSignal;
}) => AsyncIterable<ChatMessage>;

// One model step only. Tool requests become durable before the worker runs
// them; the model SDK never executes mutations inside a streaming callback.
export function chatGenerator(
  model: () => LanguageModel = chatModel,
): ChatGenerator {
  return async function* ({ messages, roster, owner, ctx, signal }) {
    const tools = assistantTools(ctx, owner.organizationId);
    for (const tool of Object.values(tools)) {
      delete tool.execute;
      delete tool.needsApproval;
    }
    const me = roster.members.find((m) => m.id === owner.userId);
    const message = messages.at(-1)!;
    const result = streamText({
      model: model(),
      tools,
      stopWhen: isStepCount(1),
      maxRetries: 1,
      system: systemPrompt({
        roster,
        organizationId: owner.organizationId,
        user: { id: owner.userId, name: me?.name ?? "this person" },
        now: new Date(),
      }),
      messages: await convertToModelMessages<ChatMessage>(messages, {
        tools,
        ignoreIncompleteToolCalls: true,
        convertDataPart: (p) =>
          p.type === "data-context"
            ? { type: "text", text: contextPrompt(p.data) }
            : undefined,
      }),
      abortSignal: signal,
      providerOptions: { openai: { store: false } },
    });
    const stream = toUIMessageStream({
      stream: result.stream,
      tools,
      sendReasoning: true,
      generateMessageId: () => message.id,
    });
    for await (const updated of readUIMessageStream<ChatMessage>({
      message: structuredClone(message),
      stream,
      terminateOnError: true,
    }))
      yield updated;
    const reason = await result.finishReason;
    if (["length", "content-filter", "error"].includes(reason))
      throw new CapabilityError(
        "unavailable",
        "Litto's answer was cut short by the AI provider. Your completed steps are saved; retry to continue.",
      );
  };
}
