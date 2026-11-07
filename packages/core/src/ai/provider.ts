// The SDK adapters of the AI providers (settings and validation are in
// ai/provider-settings.ts, which this module re-exports).
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  aiProvider,
  type AiProviderConfig,
} from "@lictory/core/ai/provider-settings";

export * from "@lictory/core/ai/provider-settings";

/** The SDK model for this configuration; only ever the selected provider. */
export function languageModel(config: AiProviderConfig): LanguageModel {
  const { apiKey, baseURL, model } = config;
  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey, baseURL })(model);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL })(model);
    case "azure":
      return createAzure({ apiKey, baseURL })(model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: "openaiCompatible",
        baseURL,
        // Keyless local servers get no Authorization header at all.
        ...(apiKey ? { apiKey } : {}),
        includeUsage: true,
        supportsStructuredOutputs: config.structuredOutput === "json-schema",
      }).chatModel(model);
  }
}

/** The configured model, or an error naming the setting to fix. */
export function configuredModel() {
  const config = aiProvider();
  if (!config)
    throw new Error("Lictory Intelligence has no configured AI provider.");
  return { config, model: languageModel(config) };
}
