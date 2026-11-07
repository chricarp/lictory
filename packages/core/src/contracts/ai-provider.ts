// The AI providers a server can be configured with, safe for browsers: names
// only, no endpoints or credentials (those stay in ai/provider.ts).
export const aiProviderKinds = [
  "openai",
  "anthropic",
  "azure",
  "openai-compatible",
] as const;
export type AiProviderKind = (typeof aiProviderKinds)[number];

export const aiProviderLabels: Record<AiProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
  "openai-compatible": "OpenAI-compatible endpoint",
};
