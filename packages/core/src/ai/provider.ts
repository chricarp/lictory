// The SDK adapters of the AI providers (settings and validation are in
// ai/provider-settings.ts, which this module re-exports). Only the selected
// provider's adapter is ever built, and every setting is passed explicitly so
// an SDK never falls back to its own environment variables.
import { lookup } from "node:dns/promises";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAssemblyAI } from "@ai-sdk/assemblyai";
import { createAzure } from "@ai-sdk/azure";
import { createDeepgram } from "@ai-sdk/deepgram";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import type { LanguageModel, TranscriptionModel } from "ai";
import {
  aiProvider,
  dictationConfig,
  isMetadataAddress,
  type AiProviderConfig,
  type TranscriptionConfig,
} from "@lictory/core/ai/provider-settings";

export * from "@lictory/core/ai/provider-settings";

export class EndpointRefused extends Error {}

/**
 * The fetch for endpoints entered in the admin console: the host must not
 * resolve to cloud instance metadata or link-local addresses (where the
 * machine's own credentials live), and redirects are not followed, so a
 * console setting cannot be turned into a request to them. Endpoints from
 * the environment are the operator's and use the plain fetch.
 */
export const guardedFetch: typeof fetch = async (input, init) => {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const host = new URL(href).hostname.replace(/^\[|\]$/g, "");
  const addresses = isMetadataAddress(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (addresses.some(({ address }) => isMetadataAddress(address)))
    throw new EndpointRefused(
      "The configured endpoint resolves to a link-local or cloud metadata address, which Lictory does not call. Use the model server's own address.",
    );
  return fetch(input, { ...init, redirect: "error" });
};

const fetchFor = (config: { source: string }) =>
  config.source === "console" ? guardedFetch : undefined;

// The server's own AWS identity (instance profile, task role, web identity
// or the AWS_* variables), when no key is configured.
const awsIdentity = () => {
  const provider = defaultProvider();
  return async () => {
    const { accessKeyId, secretAccessKey, sessionToken } = await provider();
    return { accessKeyId, secretAccessKey, sessionToken };
  };
};

/** The SDK model for this configuration; only ever the selected provider. */
export function languageModel(config: AiProviderConfig): LanguageModel {
  const { apiKey, baseURL, model } = config;
  const fetch = fetchFor(config);
  switch (config.adapter) {
    case "openai":
      return createOpenAI({ apiKey, baseURL, fetch })(model);
    case "anthropic":
      return createAnthropic({ apiKey, baseURL, fetch })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(model);
    case "vertex":
      return createVertex(
        config.apiKey
          ? { apiKey, fetch }
          : {
              project: config.project,
              location: config.location,
              fetch,
              googleAuthOptions: config.googleCredentials
                ? { credentials: config.googleCredentials }
                : {},
            },
      )(model);
    case "azure":
      return createAzure({ apiKey, baseURL, fetch })(model);
    case "bedrock":
      return createAmazonBedrock({
        region: config.region,
        ...(config.customBaseUrl ? { baseURL } : {}),
        fetch,
        ...(config.apiKey
          ? { apiKey }
          : config.accessKeyId
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : { credentialProvider: awsIdentity() }),
      })(model);
    case "mistral":
      return createMistral({ apiKey, baseURL, fetch })(model);
    case "xai":
      return createXai({ apiKey, baseURL, fetch })(model);
    case "groq":
      return createGroq({ apiKey, baseURL, fetch })(model);
    case "deepseek":
      return createDeepSeek({ apiKey, baseURL, fetch })(model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: "openaiCompatible",
        baseURL,
        // Keyless local servers get no Authorization header at all.
        ...(apiKey ? { apiKey } : {}),
        fetch,
        includeUsage: true,
        supportsStructuredOutputs: config.structuredOutput === "json-schema",
      }).chatModel(model);
  }
}

/** The configured model, or an error when none is configured. */
export function configuredModel() {
  const config = aiProvider();
  if (!config)
    throw new Error("Lictory Intelligence has no configured AI provider.");
  return { config, model: languageModel(config) };
}

/**
 * The SDK transcription model for dictation of recorded segments. Realtime
 * dictation (OpenAI Realtime) has no server-side model: the browser streams
 * to the provider with a short-lived token (intelligence/voice).
 */
export function transcriptionModel(
  config: TranscriptionConfig,
): TranscriptionModel {
  const { apiKey, baseURL, model } = config;
  const fetch = fetchFor(config);
  switch (config.adapter) {
    case "openai":
    case "openai-compatible":
      // Self-hosted Whisper servers speak OpenAI's /audio/transcriptions.
      return createOpenAI({
        apiKey: apiKey ?? "not-needed",
        baseURL,
        fetch,
      }).transcription(model);
    case "azure":
      return createAzure({ apiKey, baseURL, fetch }).transcription(model);
    case "vertex":
      return createVertex(
        config.apiKey
          ? { apiKey, fetch }
          : {
              project: config.project,
              location: config.location,
              fetch,
              googleAuthOptions: config.googleCredentials
                ? { credentials: config.googleCredentials }
                : {},
            },
      ).transcription(model);
    case "groq":
      return createGroq({ apiKey, fetch }).transcription(model);
    case "deepgram":
      return createDeepgram({ apiKey, fetch }).transcription(model);
    case "elevenlabs":
      return createElevenLabs({ apiKey, fetch }).transcription(model);
    case "assemblyai":
      return createAssemblyAI({ apiKey, fetch }).transcription(model);
    case "mistral":
      return createMistral({ apiKey, fetch }).transcription(model);
    case "openai-realtime":
      throw new Error("Realtime dictation has no server-side model.");
  }
}

/** Provider options for a transcription request. */
export function transcriptionOptions(
  config: TranscriptionConfig,
): Record<string, Record<string, string>> {
  // Self-hosted servers reliably support plain JSON; OpenAI's verbose_json
  // default is not universal.
  return config.adapter === "openai-compatible"
    ? { openai: { responseFormat: "json" } }
    : {};
}

export function configuredTranscription() {
  const config = dictationConfig();
  if (config?.mode !== "segments")
    throw new Error("Dictation of recorded segments is not configured.");
  return { config, model: transcriptionModel(config) };
}
