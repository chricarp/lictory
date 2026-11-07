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
import {
  continuedBy,
  replayableMessages,
} from "@lictory/core/intelligence/chat/replay";
import {
  providerFingerprint,
  providerOptions,
  type AiProviderConfig,
} from "@lictory/core/ai/provider";
import {
  verifyPageContexts,
  withholdUnreadablePages,
} from "@lictory/core/intelligence/chat/context";

export type ChatGenerator = (input: {
  messages: ChatMessage[];
  roster: Directory;
  owner: ChatOwner;
  ctx: CapabilityContext;
  signal: AbortSignal;
}) => AsyncIterable<ChatMessage>;

// One model step only. Tool requests become durable before the worker runs
// them; the model SDK never executes mutations inside a streaming callback.
// A substituted model (tests) answers like OpenAI at its default endpoint.
const substituted = {
  provider: "openai",
  baseURL: "https://api.openai.com/v1",
} as const;

export function chatGenerator(
  source: () =>
    | LanguageModel
    | { model: LanguageModel; config: AiProviderConfig } = chatModel,
): ChatGenerator {
  return async function* ({ messages, roster, owner, ctx, signal }) {
    const resolved = source();
    const { model, config } =
      typeof resolved === "object" && "config" in resolved
        ? resolved
        : { model: resolved, config: substituted };
    const fingerprint = providerFingerprint(config);
    const tools = assistantTools(ctx, owner.organizationId);
    for (const tool of Object.values(tools)) {
      delete tool.execute;
      delete tool.needsApproval;
    }
    const me = roster.members.find((m) => m.id === owner.userId);
    const message = messages.at(-1)!;
    // Page contexts are re-checked with the person's access now, every turn.
    const actor = {
      organizationId: owner.organizationId,
      userId: owner.userId,
    };
    const pages = await verifyPageContexts(ctx.db, actor, messages);
    // Nor do earlier tool results and answers about a page they lost.
    const sent = replayableMessages(
      await withholdUnreadablePages(ctx.db, actor, messages, pages),
      fingerprint,
    );
    // The UI message stream reports a failed model call only as text; keep
    // the provider's own error so the run can say what went wrong.
    let failure: unknown;
    const result = streamText({
      model,
      tools,
      stopWhen: isStepCount(1),
      maxRetries: 1,
      system: systemPrompt({
        roster,
        organizationId: owner.organizationId,
        user: { id: owner.userId, name: me?.name ?? "this person" },
        now: new Date(),
      }),
      messages: await convertToModelMessages<ChatMessage>(sent, {
        tools,
        ignoreIncompleteToolCalls: true,
        convertDataPart: (p) =>
          p.type === "data-context"
            ? { type: "text", text: contextPrompt(p.data, pages) }
            : undefined,
      }),
      abortSignal: signal,
      providerOptions,
      onError: ({ error }) => {
        failure = error;
      },
    });
    const stream = toUIMessageStream({
      stream: result.stream,
      tools,
      sendReasoning: true,
      generateMessageId: () => message.id,
    });
    try {
      for await (const updated of readUIMessageStream<ChatMessage>({
        // The steps generated now come from this provider.
        message: continuedBy(structuredClone(message), fingerprint),
        stream,
        terminateOnError: true,
      }))
        yield updated;
    } catch (error) {
      throw failure ?? error;
    }
    const reason = await result.finishReason;
    if (["length", "content-filter", "error"].includes(reason))
      throw new CapabilityError(
        "unavailable",
        "Litto's answer was cut short by the AI provider. Your completed steps are saved; retry to continue.",
      );
  };
}
