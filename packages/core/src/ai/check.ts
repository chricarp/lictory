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
  configuredModel,
  describeAiProvider,
  providerCapabilities,
  providerOptions,
  type AiProviderConfig,
} from "@lictory/core/ai/provider";

export type AiCheckStep = {
  id: "structured-output" | "streamed-tool-call" | "tool-result";
  /** The feature that depends on it. */
  needs: string;
  ok: boolean;
  ms: number;
  detail: string;
};

export type AiCheckReport = {
  provider: ReturnType<typeof describeAiProvider>;
  capabilities?: (typeof providerCapabilities)[keyof typeof providerCapabilities];
  checks: AiCheckStep[];
  ok: boolean;
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
  config: AiProviderConfig,
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
        error instanceof CheckFailure || error instanceof AnalyzerError
          ? error.message
          : describeProviderError(error, "Check again", config),
    };
  }
}
class CheckFailure extends Error {}

export async function checkAiProvider(
  options: {
    target?: { model: LanguageModel; config: AiProviderConfig };
    signal?: AbortSignal;
  } = {},
): Promise<AiCheckReport> {
  const provider = describeAiProvider();
  if (provider.state !== "configured" && !options.target)
    return { provider, checks: [], ok: false };
  const { model, config } = options.target ?? configuredModel();
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
    provider,
    capabilities: providerCapabilities[config.provider],
    checks,
    ok: checks.length === 3 && checks.every((c) => c.ok),
  };
}
