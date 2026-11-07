import { createHash } from "node:crypto";
import { z } from "zod";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { env } from "@lictory/core/lib/env";
import {
  OPENAI_REALTIME_URL,
  resolveTranscription,
} from "@lictory/core/ai/provider-settings";

// Live dictation for the Intelligence composer.
//
// The browser streams the microphone straight to the provider over WebRTC, so
// audio never reaches (and is never stored by) this server. The server only
// mints a short-lived, transcription-only credential after checking the
// person's membership and the organization's Lictory Intelligence opt-in.
//
// The AI SDK's streaming transcription cannot drive `gpt-live-transcribe`
// (and runs server-side over a WebSocket), so this adapter talks to the
// OpenAI Realtime API directly. Swap it for an SDK call once that is possible.

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
  model = env("LICTORY_TRANSCRIPTION_MODEL") ?? DEFAULT_TRANSCRIPTION_MODEL,
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
    fetch?: typeof fetch;
  } = {},
): Promise<DictationSession> {
  const resolved = resolveTranscription();
  const apiKey =
    options.apiKey ??
    (resolved.state === "configured" ? resolved.apiKey : undefined);
  if (!apiKey)
    throw new CapabilityError(
      "unavailable",
      "Voice input is not configured on this server. An administrator can enable it with LICTORY_TRANSCRIPTION_PROVIDER=openai.",
    );
  const baseUrl =
    options.baseUrl ??
    (resolved.state === "configured" ? resolved.baseUrl : OPENAI_REALTIME_URL);
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
        session: transcriptionSessionConfig(),
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
