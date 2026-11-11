import {
  APICallError,
  RetryError,
  generateText,
  Output,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import {
  aiFindingCategories,
  aiFindingKinds,
  aiSeverities,
} from "@lictory/core/contracts/ai";
import { itemReviewSystem, pullRequestSystem } from "@lictory/core/ai/prompts";
import { env, type Environment } from "@lictory/core/lib/env";
import {
  aiProvider,
  configuredModel,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_TIMEOUT_SECONDS,
  EndpointRefused,
  EntraError,
  hostModelServer,
  isLoopbackUrl,
  providerOptions,
  structuredSystem,
  type AiProviderConfig,
} from "@lictory/core/ai/provider";
import type {
  ItemReviewContext,
  PullRequestContext,
} from "@lictory/core/ai/context";

// What the model may return. Every field is required (nullable instead of
// optional) so providers with strict structured output accept the schema. The
// output is still validated and filtered against the analysed context later.
const finding = z.object({
  itemKey: z
    .string()
    .describe("Key of the work item the finding is about, e.g. PAY-12."),
  kind: z.enum(aiFindingKinds),
  category: z.enum(aiFindingCategories),
  severity: z.enum(aiSeverities),
  title: z.string().describe("One sentence naming the gap."),
  detail: z
    .string()
    .describe("Why it matters for delivery, in two or three sentences."),
  evidence: z
    .array(z.string())
    .describe("Verbatim quotes from the analysed content. Empty if absent."),
  question: z
    .string()
    .nullable()
    .describe("A question only the team can answer, or null."),
  recommendation: z
    .string()
    .nullable()
    .describe("What the team should do, or null."),
  edit: z
    .object({
      section: z.string().describe("Heading the change belongs under."),
      find: z
        .string()
        .describe(
          "Exact text copied from the current content to replace. Empty string to append under the section.",
        ),
      replace: z.string().describe("Replacement text in Markdown."),
    })
    .nullable()
    .describe(
      "Only when the fix needs no new product decision. Otherwise null and ask a question.",
    ),
  contextRefs: z
    .array(z.string())
    .describe(
      "Refs (for example C2) of the Lictory Intelligence Context entries this finding relies on. Empty if none.",
    ),
});
export const itemReviewOutput = z.object({
  summary: z.string().describe("Two to four sentences for the team."),
  strengths: z.array(z.string()).describe("Up to three things done well."),
  findings: z.array(finding),
});
// Two readings of one acceptance criterion the pull request adds or changes.
const reading = z.object({
  criterionRef: z
    .string()
    .describe("Ref of the acceptance criterion, for example A1."),
  qa: z
    .array(
      z.object({
        situation: z
          .string()
          .describe("Inputs, state or timing of one concrete test case."),
        expected: z
          .string()
          .describe("The observable outcome the tester would expect."),
      }),
    )
    .describe("Concrete cases a QA engineer would run, two to five."),
  implementer: z.object({
    builds: z
      .string()
      .describe("What an implementer would build from this text."),
    done: z.string().describe("What the implementer would consider done."),
  }),
  diverges: z
    .boolean()
    .describe(
      "True only when the readings expect a different observable outcome for some situation.",
    ),
  divergence: z
    .string()
    .nullable()
    .describe(
      "The situation and the two different outcomes, or null when they agree.",
    ),
  question: z
    .string()
    .nullable()
    .describe("The decision that would settle it, or null."),
  severity: z.enum(["major", "minor"]),
  previousFindingId: z
    .string()
    .nullable()
    .describe(
      "Id of an open previous finding about the same criterion, otherwise null.",
    ),
});
const pullRequestOutput = z.object({
  summary: z
    .string()
    .describe("What the change does and the overall assessment."),
  strengths: z.array(z.string()),
  readings: z
    .array(reading)
    .describe("One entry per acceptance criterion in acceptanceCriteria."),
  findings: z.array(
    finding.extend({
      previousFindingId: z
        .string()
        .nullable()
        .describe(
          "Id of an open previous finding this one repeats, otherwise null.",
        ),
    }),
  ),
});
export type ItemReviewOutput = z.infer<typeof itemReviewOutput>;
export type PullRequestOutput = z.infer<typeof pullRequestOutput>;

// The domain depends on this interface, not on a provider. Tests and failure
// drills substitute their own implementation.
// `abortSignal` cancels the provider call (run deadline, worker shutdown).
export type AnalyzerCall = { abortSignal?: AbortSignal };
export type Analyzer = {
  model: string;
  reviewItem(
    context: ItemReviewContext,
    call?: AnalyzerCall,
  ): Promise<ItemReviewOutput>;
  reviewPullRequest(
    context: PullRequestContext,
    call?: AnalyzerCall,
  ): Promise<PullRequestOutput>;
};

// LICTORY_AI_MODEL, or the default when it is unset or blank.
export function aiModelId(source: Environment = process.env) {
  return env("LICTORY_AI_MODEL", source) ?? DEFAULT_AI_MODEL;
}

export { DEFAULT_AI_MODEL };
export class AnalyzerError extends Error {}

// How structured calls are made. A substituted model (tests, drills) behaves
// like a provider with native JSON schema support.
type Target = {
  model: LanguageModel;
  config: Pick<
    AiProviderConfig,
    "provider" | "structuredOutput" | "timeoutMs" | "baseURL" | "keySetting"
  >;
};
const substituted: Target["config"] = {
  provider: "openai",
  structuredOutput: "json-schema",
  timeoutMs: DEFAULT_AI_TIMEOUT_SECONDS * 1000,
  baseURL: "https://api.openai.com/v1",
};

/** The configured provider's model, or the substitute a caller passes. */
export function analyzerTarget(
  options: { model?: LanguageModel; modelId?: string } = {},
): Target & { modelId: string } {
  if (options.model)
    return {
      model: options.model,
      config: substituted,
      modelId: options.modelId ?? aiModelId(),
    };
  const { model, config } = configuredModel();
  return { model, config, modelId: config.model };
}

export function createAnalyzer(
  options: { model?: LanguageModel; modelId?: string } = {},
): Analyzer {
  const target = analyzerTarget(options);
  const run = <T>(
    schema: z.ZodType<T>,
    name: string,
    system: string,
    prompt: string,
    call: AnalyzerCall = {},
  ) => generateStructured(target, { schema, name, system, prompt }, call);
  return {
    model: target.modelId,
    reviewItem: (context, call) =>
      run(
        itemReviewOutput,
        "item_review",
        itemReviewSystem,
        JSON.stringify(context),
        call,
      ),
    reviewPullRequest: (context, call) =>
      run(
        pullRequestOutput,
        "pull_request_review",
        pullRequestSystem,
        JSON.stringify(context),
        call,
      ),
  };
}

// One structured model call with Lictory's provider settings. Shared by the
// review analyzer and proposal intake so both keep the same deadline, retry
// and retention behaviour. `again` completes failure messages ("Run the
// review again").
export async function generateStructured<T>(
  target: Target,
  request: {
    schema: z.ZodType<T>;
    name: string;
    system: string;
    prompt: string;
  },
  call: AnalyzerCall = {},
  again = "Run the review again",
): Promise<T> {
  try {
    const { output } = await generateText({
      model: target.model,
      system: structuredSystem(target.config, request.system, request.schema),
      prompt: request.prompt,
      output: Output.object({ schema: request.schema, name: request.name }),
      maxRetries: 2,
      // Covers every retry; below the run deadline in the runner.
      timeout: { totalMs: target.config.timeoutMs },
      abortSignal: call.abortSignal,
      // Customer content is not retained by the provider for later use.
      providerOptions,
    });
    return output;
  } catch (error) {
    throw new AnalyzerError(describeProviderError(error, again, target.config));
  }
}

// Whether a failure came from the AI provider call itself (as opposed to
// Lictory's own tools or storage).
export function isProviderError(error: unknown) {
  return APICallError.isInstance(error) || RetryError.isInstance(error);
}

const mentions = (text: string, ...patterns: RegExp[]) =>
  patterns.every((p) => p.test(text));

// Actionable, secret-free messages; raw provider bodies never reach users
// (they are only matched against known failure shapes). `again` names the
// person's next step ("Retry", "Run the review again").
export function describeProviderError(
  error: unknown,
  again: string,
  config: Pick<AiProviderConfig, "provider" | "baseURL" | "keySetting"> & {
    /** What names the model and the URL, and what the service is called
     * (dictation names its own settings). */
    modelSetting?: string;
    urlSetting?: string;
    service?: string;
  } = aiProvider() ?? substituted,
) {
  const service = config.service ?? "AI provider";
  const model = config.modelSetting ?? "LICTORY_AI_MODEL";
  const url = config.urlSetting ?? "LICTORY_AI_BASE_URL";
  // Our own explanations (Microsoft Entra sign-in, refused endpoints) are
  // written for people already, also when the SDK wrapped them.
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (e instanceof EntraError || e instanceof EndpointRefused)
      return e.message;
    if (RetryError.isInstance(e)) e = e.lastError;
    else e = (e as { cause?: unknown }).cause;
  }
  // After its retries, the SDK reports the last attempt's failure.
  const last = RetryError.isInstance(error) ? error.lastError : error;
  const e = last as {
    name?: string;
    statusCode?: number;
    message?: string;
    responseBody?: string;
  };
  const explicit = config.keySetting !== "OPENAI_API_KEY";
  const keySetting = config.keySetting ?? "LICTORY_AI_API_KEY";
  const body = `${e?.message ?? ""} ${e?.responseBody ?? ""}`;
  if (e?.statusCode === 401 || e?.statusCode === 403)
    return `The ${service} rejected the configured credentials. Ask an administrator to check ${keySetting}.`;
  if (e?.statusCode === 404)
    return config.provider === "azure"
      ? `The configured Azure deployment is unavailable. Ask an administrator to check ${model} (the deployment name) and ${url}.`
      : `The configured model is unavailable. Ask an administrator to check ${model}${explicit && config.provider !== "openai" ? ` and ${url}` : ""}.`;
  if (e?.statusCode === 429)
    return `The ${service} is rate limiting requests. ${again} in a few minutes.`;
  if (e?.statusCode === 400 || e?.statusCode === 422) {
    if (
      mentions(
        body,
        /\btools?\b|function.?call/i,
        /not support|unsupported|not allowed/i,
      )
    )
      return "The configured AI model does not support tool calls, which Litto needs. Ask an administrator to choose a model with tool support (sudo lictory ai check, or Check connection in the admin console, tests it).";
    if (
      mentions(
        body,
        /response_format|json_schema|structured output|output_format|output_config/i,
        /support|unknown|unrecognized|not allowed|invalid/i,
      )
    )
      return config.provider === "openai-compatible"
        ? "The AI endpoint does not accept JSON schema output. Ask an administrator to set LICTORY_AI_STRUCTURED_OUTPUT=json-object or choose a model that supports it."
        : "The configured AI model does not support structured output. Ask an administrator to choose a model that does.";
    if (
      mentions(
        body,
        /context|too long|too many tokens|maximum.*(?:length|tokens)|num_ctx/i,
      )
    )
      return `The request is longer than the AI model accepts. ${again} with less content, or ask an administrator to raise the model's context length.`;
  }
  if (e?.name?.includes("NoObjectGenerated") || e?.name?.includes("NoOutput"))
    return `The model did not return a valid result. ${again}.`;
  if (e?.name?.includes("Timeout") || e?.name === "AbortError")
    return `The ${service} did not answer in time. ${again}.`;
  // No response at all: the server could not connect to the provider.
  if (APICallError.isInstance(last) && last.statusCode === undefined)
    return /\/\/host\.docker\.internal[:/]/.test(config.baseURL) &&
      !hostModelServer()
      ? `This server could not reach the ${service} on this machine. ${again} later, or ask an administrator to set LICTORY_HOST_MODEL_SERVER=true on the server (sudo lictory config set LICTORY_HOST_MODEL_SERVER=true) and check that the model server listens on 0.0.0.0.`
      : isLoopbackUrl(config.baseURL)
        ? `This server could not reach the ${service}. ${again} later, or ask an administrator to check ${url}: it points at localhost, which inside a container is the container itself, not the server.`
        : `This server could not reach the ${service}. ${again} later, or ask an administrator to check the server's network access to the provider${explicit ? ` (${url})` : ""}.`;
  return `The ${service} could not complete the request. ${again} shortly.`;
}
