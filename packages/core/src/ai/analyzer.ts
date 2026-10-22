import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";
import {
  aiFindingCategories,
  aiFindingKinds,
  aiSeverities,
} from "@lictory/core/contracts/ai";
import { itemReviewSystem, pullRequestSystem } from "@lictory/core/ai/prompts";
import type { ItemReviewContext, PullRequestContext } from "@lictory/core/ai/context";

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
export type Analyzer = {
  model: string;
  reviewItem(context: ItemReviewContext): Promise<ItemReviewOutput>;
  reviewPullRequest(context: PullRequestContext): Promise<PullRequestOutput>;
};

export const DEFAULT_AI_MODEL = "gpt-6-luna";
export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export class AnalyzerError extends Error {}

export function createAnalyzer(
  options: { model?: LanguageModel; modelId?: string } = {},
): Analyzer {
  const modelId =
    options.modelId ?? process.env.LICTORY_AI_MODEL?.trim() ?? DEFAULT_AI_MODEL;
  const model =
    options.model ??
    createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
  async function run<T>(
    schema: z.ZodType<T>,
    name: string,
    system: string,
    prompt: string,
  ): Promise<T> {
    try {
      const { output } = await generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema, name }),
        maxRetries: 2,
        timeout: { totalMs: 240_000 },
        // Customer content is not retained by the provider for later use.
        providerOptions: { openai: { store: false } },
      });
      return output;
    } catch (error) {
      throw new AnalyzerError(describe(error));
    }
  }
  return {
    model: modelId,
    reviewItem: (context) =>
      run(
        itemReviewOutput,
        "item_review",
        itemReviewSystem,
        JSON.stringify(context),
      ),
    reviewPullRequest: (context) =>
      run(
        pullRequestOutput,
        "pull_request_review",
        pullRequestSystem,
        JSON.stringify(context),
      ),
  };
}

// Actionable, secret-free messages; raw provider bodies never reach users.
function describe(error: unknown) {
  const e = error as {
    name?: string;
    statusCode?: number;
    message?: string;
  };
  if (e?.statusCode === 401 || e?.statusCode === 403)
    return "The AI provider rejected the configured credentials. Ask an administrator to check OPENAI_API_KEY.";
  if (e?.statusCode === 404)
    return "The configured AI model is unavailable. Ask an administrator to check LICTORY_AI_MODEL.";
  if (e?.statusCode === 429)
    return "The AI provider is rate limiting requests. Run the review again in a few minutes.";
  if (e?.name?.includes("NoObjectGenerated") || e?.name?.includes("NoOutput"))
    return "The model did not return a valid review. Run the review again.";
  if (e?.name?.includes("Timeout") || e?.name === "AbortError")
    return "The AI provider did not answer in time. Run the review again.";
  return "The AI provider could not complete the review. Run it again shortly.";
}
