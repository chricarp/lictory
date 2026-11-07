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

// Provider metadata removed, reasoning text kept for the person to read.
function withoutProviderMetadata(parts: ChatMessage["parts"]) {
  return parts.map((part) => {
    if (!metadataKeys.some((key) => key in part)) return part;
    const copy: Record<string, unknown> = { ...part };
    for (const key of metadataKeys) delete copy[key];
    return copy as typeof part;
  });
}

/**
 * The assistant message a provider continues, stamped as its own. Steps an
 * earlier provider generated in it keep their text but lose that provider's
 * metadata, so the stamp never vouches for metadata another provider wrote.
 */
export function continuedBy(
  message: ChatMessage,
  fingerprint: string,
): ChatMessage {
  const origin = message.metadata?.generatedBy ?? legacyFingerprint;
  return {
    ...message,
    parts:
      origin === fingerprint
        ? message.parts
        : withoutProviderMetadata(message.parts),
    metadata: { ...message.metadata, generatedBy: fingerprint },
  };
}

export function replayableMessages(
  messages: ChatMessage[],
  fingerprint: string,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const origin = message.metadata?.generatedBy ?? legacyFingerprint;
    // Reasoning is replayed only with the metadata its provider needs; a
    // reasoning part without any (from another provider, or one that sends
    // none) is left out.
    const parts = message.parts.filter(
      (part) => part.type !== "reasoning" || "providerMetadata" in part,
    );
    if (origin === fingerprint)
      return parts.length === message.parts.length
        ? message
        : { ...message, parts };
    return {
      ...message,
      parts: withoutProviderMetadata(
        message.parts.filter((part) => part.type !== "reasoning"),
      ),
    };
  });
}
