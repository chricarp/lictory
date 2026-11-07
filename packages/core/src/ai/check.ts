// A live check of the configured AI provider, for the operator: does this
// endpoint and model do what Lictory Intelligence needs? It sends only
// synthetic content (no organization data), to the configured provider only,
// and keeps nothing: the result is returned, not stored.
//
// Passing proves protocol compatibility on that day, not quality: a model
// that returns a valid review of a toy item may still miss real gaps, follow
// instructions poorly or run out of context on long specifications.
import { generateText, streamText, tool, type LanguageModel } from "ai";
import { z } from "zod";
import {
  AnalyzerError,
  describeProviderError,
  generateStructured,
  itemReviewOutput,
} from "@lictory/core/ai/analyzer";
import { itemReviewSystem } from "@lictory/core/ai/prompts";
import {
  aiState,
  EndpointRefused,
  languageModel,
  providerOptions,
  transcriptionModel,
  transcriptionOptions,
  type AiProviderConfig,
  type AiResolution,
  type TranscriptionConfig,
  type TranscriptionResolution,
} from "@lictory/core/ai/provider";
import { experimental_transcribe as transcribe } from "ai";
import { CapabilityError } from "@lictory/core/capabilities/core";
import { createDictationSession } from "@lictory/core/intelligence/voice/transcription";

export type AiCheckStep = {
  id: "structured-output" | "streamed-tool-call" | "tool-result" | "dictation";
  /** The feature that depends on it. */
  needs: string;
  ok: boolean;
  ms: number;
  detail: string;
};

export type AiCheckReport = {
  /** Every configured part passed. */
  ok: boolean;
  text: {
    state: AiResolution["state"];
    problems: string[];
    checks: AiCheckStep[];
    ok: boolean;
  };
  dictation: {
    state: TranscriptionResolution["state"];
    problems: string[];
    checks: AiCheckStep[];
    ok: boolean;
  };
};

const item = {
  key: "DEMO-1",
  title: "Retry failed card payments",
  specification:
    "## Behavior\nWhen a card payment fails, the system retries it.\n\n## Acceptance criteria\n- A failed payment is retried.",
};
const lookup = tool({
  description: "Look up a work item by its key.",
  inputSchema: z.object({ key: z.string() }),
});
const lookupPrompt = `Use the lookupWorkItem tool to look up work item ${item.key}, then say its status.`;

async function step(
  id: AiCheckStep["id"],
  needs: string,
  run: () => Promise<string>,
  config: Pick<AiProviderConfig, "provider" | "baseURL" | "keySetting">,
): Promise<AiCheckStep> {
  const started = Date.now();
  try {
    const detail = await run();
    return { id, needs, ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return {
      id,
      needs,
      ok: false,
      ms: Date.now() - started,
      detail:
        error instanceof CheckFailure ||
        error instanceof AnalyzerError ||
        error instanceof EndpointRefused ||
        error instanceof CapabilityError
          ? error.message
          : describeProviderError(error, "Check again", config),
    };
  }
}
class CheckFailure extends Error {}

/**
 * Checks text and dictation: those configured now, or candidate settings
 * before they are saved (the admin console's and the CLI's Test).
 */
export async function checkAiProvider(
  options: {
    text?: AiResolution;
    transcription?: TranscriptionResolution;
    /** Substitutes the text model (tests). */
    model?: LanguageModel;
    signal?: AbortSignal;
  } = {},
): Promise<AiCheckReport> {
  const state = aiState();
  const textResolution = options.text ?? state.text;
  const dictationResolution = options.transcription ?? state.transcription;
  const textPart = await checkText(textResolution, options);
  const dictationPart = await checkDictation(dictationResolution, options);
  return {
    ok:
      (textPart.state !== "configured" || textPart.ok) &&
      (dictationPart.state !== "configured" || dictationPart.ok) &&
      textPart.state === "configured",
    text: textPart,
    dictation: dictationPart,
  };
}

async function checkText(
  resolution: AiResolution,
  options: { model?: LanguageModel; signal?: AbortSignal },
): Promise<AiCheckReport["text"]> {
  if (resolution.state !== "configured")
    return {
      state: resolution.state,
      problems: resolution.state === "invalid" ? resolution.problems : [],
      checks: [],
      ok: false,
    };
  const { config } = resolution;
  let model: LanguageModel;
  try {
    model = options.model ?? languageModel(config);
  } catch (error) {
    return {
      state: "configured",
      problems: [],
      checks: [
        {
          id: "structured-output",
          needs: "Every Lictory Intelligence feature",
          ok: false,
          ms: 0,
          detail: describeProviderError(error, "Check again", config),
        },
      ],
      ok: false,
    };
  }
  const deadline = () =>
    AbortSignal.any([
      AbortSignal.timeout(config.timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);
  const checks: AiCheckStep[] = [];

  // Reviews and proposal intake: the real review schema and instructions.
  checks.push(
    await step(
      "structured-output",
      "Item reviews, pull request reviews, proposal intake and conversation titles",
      async () => {
        const output = await generateStructured(
          { model, config },
          {
            schema: itemReviewOutput,
            name: "item_review",
            system: itemReviewSystem,
            prompt: JSON.stringify({ items: [item], intelligenceContext: [] }),
          },
          { abortSignal: deadline() },
          "Check again",
        );
        return `A valid review came back (${output.findings.length} finding${output.findings.length === 1 ? "" : "s"}).`;
      },
      config,
    ),
  );

  // Litto: one streamed step that requests a tool, as the assistant does.
  let call: { toolCallId: string; input: unknown } | undefined;
  checks.push(
    await step(
      "streamed-tool-call",
      "Litto (the assistant)",
      async () => {
        let failure: unknown;
        const result = streamText({
          model,
          tools: { lookupWorkItem: lookup },
          prompt: lookupPrompt,
          maxRetries: 0,
          abortSignal: deadline(),
          providerOptions,
          // The SDK would log the error with the request; it is reported
          // once, below, without it.
          onError: ({ error }) => {
            failure ??= error;
          },
        });
        for await (const part of result.fullStream) {
          if (part.type === "error") failure ??= part.error;
          if (part.type === "tool-call" && part.toolName === "lookupWorkItem")
            call = { toolCallId: part.toolCallId, input: part.input };
        }
        if (failure instanceof Error) throw failure;
        if (failure)
          throw new CheckFailure(
            "The AI provider's stream failed. Check again.",
          );
        if (!call)
          throw new CheckFailure(
            "The model answered without calling the tool. Litto needs a model that calls tools reliably; choose one with tool support.",
          );
        return "The model requested the tool while streaming.";
      },
      config,
    ),
  );

  // Litto continues after the worker records a tool result.
  if (call) {
    const { toolCallId, input } = call;
    checks.push(
      await step(
        "tool-result",
        "Litto (the assistant)",
        async () => {
          const { text } = await generateText({
            model,
            tools: { lookupWorkItem: lookup },
            messages: [
              { role: "user", content: lookupPrompt },
              {
                role: "assistant",
                content: [
                  {
                    type: "tool-call",
                    toolCallId,
                    toolName: "lookupWorkItem",
                    input,
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId,
                    toolName: "lookupWorkItem",
                    output: {
                      type: "json",
                      value: { key: item.key, status: "In review" },
                    },
                  },
                ],
              },
            ],
            maxRetries: 0,
            abortSignal: deadline(),
            providerOptions,
          });
          if (!text.trim())
            throw new CheckFailure(
              "The model returned no answer after the tool result.",
            );
          return /in review/i.test(text)
            ? "The model used the tool result in its answer."
            : "The model answered after the tool result, but did not repeat it.";
        },
        config,
      ),
    );
  }
  return {
    state: "configured",
    problems: [],
    checks,
    ok: checks.length === 3 && checks.every((c) => c.ok),
  };
}

/** A second of a quiet 440 Hz tone: 16 kHz mono 16-bit WAV. */
export function syntheticWav(seconds = 1) {
  const rate = 16_000;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 1500),
      true,
    );
  return new Uint8Array(buffer);
}

async function checkDictation(
  resolution: TranscriptionResolution,
  options: { signal?: AbortSignal },
): Promise<AiCheckReport["dictation"]> {
  if (resolution.state !== "configured")
    return {
      state: resolution.state,
      problems: resolution.state === "invalid" ? resolution.problems : [],
      checks: [],
      ok: false,
    };
  const { config } = resolution;
  const named = {
    provider: "openai-compatible" as const,
    baseURL: config.baseURL,
    keySetting: config.keySetting,
  };
  const check = await step(
    "dictation",
    "Dictation in the Litto composer",
    config.mode === "realtime"
      ? () => checkRealtime(config)
      : () => checkSegments(config, options.signal),
    named,
  );
  return { state: "configured", problems: [], checks: [check], ok: check.ok };
}

async function checkRealtime(config: TranscriptionConfig) {
  // Minting a session proves the key and model; no audio is sent.
  await createDictationSession("lictory-check", {
    apiKey: config.apiKey,
    baseUrl: config.baseURL,
    model: config.model,
  });
  return "The provider issued a live dictation session.";
}

async function checkSegments(
  config: TranscriptionConfig,
  signal?: AbortSignal,
) {
  try {
    const result = await transcribe({
      model: transcriptionModel(config),
      audio: syntheticWav(),
      providerOptions: transcriptionOptions(config),
      maxRetries: 0,
      abortSignal: AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]),
    });
    return result.text.trim()
      ? "The provider transcribed a test clip."
      : "The provider accepted a test clip (a tone, so no words came back).";
  } catch (error) {
    if (error instanceof Error && error.name.includes("NoTranscriptGenerated"))
      return "The provider accepted a test clip (a tone, so no words came back).";
    throw error;
  }
}
