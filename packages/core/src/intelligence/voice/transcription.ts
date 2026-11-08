import { createHash } from "node:crypto";
import { z } from "zod";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { env } from "@lictory/core/lib/env";
import { experimental_transcribe as transcribe } from "ai";
import {
  dictationConfig,
  OPENAI_REALTIME_URL,
} from "@lictory/core/ai/provider-settings";
import {
  EndpointRefused,
  transcriptionModel,
  transcriptionOptions,
} from "@lictory/core/ai/provider";
import { describeProviderError } from "@lictory/core/ai/analyzer";

// Dictation for the Litto composer, in one of two modes (the provider
// decides, contracts/ai-provider.ts):
//
// - realtime (OpenAI Realtime): the browser streams the microphone straight
//   to the provider over WebRTC, so audio never reaches this server. The
//   server only mints a short-lived, transcription-only credential.
// - segments (every other provider, cloud or self-hosted): the browser
//   records a short clip at each pause and posts it here; the server sends
//   it to the provider and returns the text. Audio is held in memory for one
//   request and never stored or logged.
//
// Both check the person's membership and the organization's Lictory
// Intelligence opt-in first (routes/intelligence.ts).
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
// Only long enough to open the WebRTC connection; the session lives on after.
const CREDENTIAL_TTL_SECONDS = 60;

export type DictationSession = {
  provider: "openai";
  token: string;
  expiresAt: number;
  // Where the browser posts its SDP offer.
  callsUrl: string;
};

export function transcriptionSessionConfig(
  model = dictationConfig()?.model ??
    env("LICTORY_TRANSCRIPTION_MODEL") ??
    DEFAULT_TRANSCRIPTION_MODEL,
) {
  return {
    type: "transcription" as const,
    audio: {
      input: {
        // WebRTC negotiates the audio format, so `format` is omitted.
        noise_reduction: { type: "near_field" },
        transcription: { model, delay: "low" },
        // gpt-live-transcribe has no server VAD; the browser commits on stop.
        turn_detection: null,
      },
    },
  };
}

const secret = z.object({ value: z.string().min(1), expires_at: z.number() });

export async function createDictationSession(
  userId: string,
  options: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fetch?: typeof fetch;
  } = {},
): Promise<DictationSession> {
  const config = dictationConfig();
  const realtime = config?.mode === "realtime" ? config : undefined;
  const apiKey = options.apiKey ?? realtime?.apiKey;
  if (!apiKey)
    throw new CapabilityError(
      "unavailable",
      config
        ? "This server dictates recorded clips, not live audio. Reload the page and try again."
        : "Voice input is not configured on this server. An instance administrator can turn on dictation in the admin console, or with LICTORY_TRANSCRIPTION_PROVIDER.",
    );
  const baseUrl = options.baseUrl ?? realtime?.baseURL ?? OPENAI_REALTIME_URL;
  const response = await (options.fetch ?? fetch)(
    `${baseUrl}/realtime/client_secrets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Stable, non-identifying per-user value for provider abuse controls.
        "OpenAI-Safety-Identifier": createHash("sha256")
          .update(userId)
          .digest("hex"),
      },
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: CREDENTIAL_TTL_SECONDS,
        },
        session: transcriptionSessionConfig(options.model),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new CapabilityError(
      "unavailable",
      `The speech-to-text provider refused to start a session (HTTP ${response.status}). Try again, or type your message.`,
    );
  const parsed = secret.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new CapabilityError(
      "unavailable",
      "The speech-to-text provider returned an unexpected response. Try again, or type your message.",
    );
  return {
    provider: "openai",
    token: parsed.data.value,
    expiresAt: parsed.data.expires_at,
    callsUrl: `${baseUrl}/realtime/calls`,
  };
}

// ---------------------------------------------------------------- segments

/** The largest clip accepted: about 30 s of 16 kHz mono 16-bit WAV. */
export const MAX_SEGMENT_BYTES = 1_200_000;
const audioTypes = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
]);

/**
 * Transcribes one recorded clip with the configured provider. The audio is
 * not kept: it lives in this call only, and failures never include it.
 */
export async function transcribeSegment(
  audio: Uint8Array,
  mediaType: string,
  options: { signal?: AbortSignal } = {},
) {
  const config = dictationConfig();
  if (config?.mode !== "segments")
    throw new CapabilityError(
      "unavailable",
      config
        ? "This server dictates live audio. Reload the page and try again."
        : "Voice input is not configured on this server.",
    );
  const type = mediaType.split(";")[0]!.trim().toLowerCase();
  if (!audioTypes.has(type))
    throw new CapabilityError("validation", "Unsupported audio format.");
  if (audio.byteLength === 0 || audio.byteLength > MAX_SEGMENT_BYTES)
    throw new CapabilityError(
      "validation",
      "A dictated clip must be between 0 and 30 seconds long.",
    );
  try {
    const result = await transcribe({
      model: transcriptionModel(config),
      audio,
      providerOptions: transcriptionOptions(config),
      maxRetries: 1,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(config.timeoutMs),
        ...(options.signal ? [options.signal] : []),
      ]),
    });
    return { text: result.text.trim() };
  } catch (error) {
    // An empty clip (silence) is not a failure.
    if (error instanceof Error && error.name.includes("NoTranscriptGenerated"))
      return { text: "" };
    throw new CapabilityError(
      "unavailable",
      error instanceof EndpointRefused
        ? error.message
        : describeProviderError(error, "Try again", {
            provider: "openai-compatible",
            baseURL: config.baseURL,
            keySetting: config.keySetting,
          }).replace("AI provider", "speech-to-text provider"),
    );
  }
}
