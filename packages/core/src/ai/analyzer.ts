import { createOpenAI } from "@ai-sdk/openai";
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
const itemReviewOutput = z.object({
  summary: z.string().describe("Two to four sentences for the team."),
  strengths: z.array(z.string()).describe("Up to three things done well."),
  findings: z.array(finding),
});
const pullRequestOutput = z.object({
  summary: z
    .string()
    .describe("What the change does and the overall assessment."),
  strengths: z.array(z.string()),
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

export const DEFAULT_AI_MODEL = "gpt-6-luna";
// LICTORY_AI_MODEL, or the default when it is unset or blank.
export function aiModelId(source: Environment = process.env) {
  return env("LICTORY_AI_MODEL", source) ?? DEFAULT_AI_MODEL;
}
export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export class AnalyzerError extends Error {}

export function createAnalyzer(
  options: { model?: LanguageModel; modelId?: string } = {},
): Analyzer {
  const modelId = options.modelId ?? aiModelId();
  const model =
    options.model ?? createOpenAI({ apiKey: env("OPENAI_API_KEY") })(modelId);
  const run = <T>(
    schema: z.ZodType<T>,
    name: string,
    system: string,
    prompt: string,
    call: AnalyzerCall = {},
  ) => generateStructured(model, { schema, name, system, prompt }, call);
  return {
    model: modelId,
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
  model: LanguageModel,
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
      model,
      system: request.system,
      prompt: request.prompt,
      output: Output.object({ schema: request.schema, name: request.name }),
      maxRetries: 2,
      // Covers every retry; well below the run lease in the runner.
      timeout: { totalMs: 240_000 },
      abortSignal: call.abortSignal,
      // Customer content is not retained by the provider for later use.
      providerOptions: { openai: { store: false } },
    });
    return output;
  } catch (error) {
    throw new AnalyzerError(describeProviderError(error, again));
  }
}

// Whether a failure came from the AI provider call itself (as opposed to
// Lictory's own tools or storage).
export function isProviderError(error: unknown) {
  return APICallError.isInstance(error) || RetryError.isInstance(error);
}

// Actionable, secret-free messages; raw provider bodies never reach users.
// `again` names the person's next step ("Retry", "Run the review again").
export function describeProviderError(error: unknown, again: string) {
  // After its retries, the SDK reports the last attempt's failure.
  const last = RetryError.isInstance(error) ? error.lastError : error;
  const e = last as {
    name?: string;
    statusCode?: number;
    message?: string;
  };
  if (e?.statusCode === 401 || e?.statusCode === 403)
    return "The AI provider rejected the configured credentials. Ask an administrator to check OPENAI_API_KEY.";
  if (e?.statusCode === 404)
    return "The configured AI model is unavailable. Ask an administrator to check LICTORY_AI_MODEL.";
  if (e?.statusCode === 429)
    return `The AI provider is rate limiting requests. ${again} in a few minutes.`;
  if (e?.name?.includes("NoObjectGenerated") || e?.name?.includes("NoOutput"))
    return `The model did not return a valid result. ${again}.`;
  if (e?.name?.includes("Timeout") || e?.name === "AbortError")
    return `The AI provider did not answer in time. ${again}.`;
  // No response at all: the server could not connect to the provider.
  if (APICallError.isInstance(last) && last.statusCode === undefined)
    return `This server could not reach the AI provider. ${again} later, or ask an administrator to check the server's network access to the provider.`;
  return `The AI provider could not complete the request. ${again} shortly.`;
}
