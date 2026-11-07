import { legacyFingerprint } from "@lictory/core/ai/provider-settings";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";

// Earlier turns are sent again with every question. What a provider attached
// to its own output (OpenAI reasoning items and encrypted reasoning, Anthropic
// thinking signatures, response item ids) is only meaningful to that provider
// and endpoint, and another one may reject it. Each assistant message records
// which provider generated it (`metadata.generatedBy`); when that is not the
// provider answering now, the copy sent to the provider keeps the text, tool
// calls and tool results, and leaves out the reasoning and provider metadata.
// The stored transcript is unchanged.

const metadataKeys = [
  "providerMetadata",
  "callProviderMetadata",
  "resultProviderMetadata",
] as const;

export function replayableMessages(
  messages: ChatMessage[],
  fingerprint: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const origin = message.metadata?.generatedBy ?? legacyFingerprint;
    if (origin === fingerprint) return message;
    return {
      ...message,
      parts: message.parts
        .filter((part) => part.type !== "reasoning")
        .map((part) => {
          if (!metadataKeys.some((key) => key in part)) return part;
          const copy: Record<string, unknown> = { ...part };
          for (const key of metadataKeys) delete copy[key];
          return copy as typeof part;
        }),
    };
  });
}
