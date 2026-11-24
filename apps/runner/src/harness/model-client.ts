import type {
  LanguageModelV4,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { decodeWire, encodeWire } from "@lictory/core/factory/model-wire";
import type { RunnerClient } from "@lictory/runner/client";

// A language model whose calls run on the Lictory server, with the
// organization's configured provider (`/sessions/:id/model`). The tool loop
// and the tools stay on the runner; the model key stays on the server.

function lines(): TransformStream<string, string> {
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) controller.enqueue(line);
      }
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(buffer.trim());
    },
  });
}

export function proxyModel(
  client: RunnerClient,
  sessionId: string,
  leaseToken: string,
  modelId = "lictory-intelligence",
): LanguageModelV4 {
  const stream = async (
    options: Parameters<LanguageModelV4["doStream"]>[0],
  ) => {
    const { abortSignal, headers, ...call } = options;
    void headers;
    const response = await client
      .session(sessionId)
      .model(leaseToken, encodeWire(call), abortSignal);
    if (!response.body) throw new Error("The model proxy sent no response.");
    return response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(lines())
      .pipeThrough(
        new TransformStream<string, LanguageModelV4StreamPart>({
          transform(line, controller) {
            controller.enqueue(
              decodeWire(JSON.parse(line)) as LanguageModelV4StreamPart,
            );
          },
        }),
      );
  };
  return {
    specificationVersion: "v4",
    provider: "lictory",
    modelId,
    supportedUrls: {},
    async doStream(options) {
      return { stream: await stream(options) };
    },
    // Built from the stream: the proxy only streams.
    async doGenerate(options) {
      const reader = (await stream(options)).getReader();
      const content: LanguageModelV4Content[] = [];
      let text = "";
      let reasoning = "";
      let finish:
        Extract<LanguageModelV4StreamPart, { type: "finish" }> | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "text-delta") text += value.delta;
        else if (value.type === "reasoning-delta") reasoning += value.delta;
        else if (value.type === "tool-call") content.push(value);
        else if (value.type === "error") throw value.error;
        else if (value.type === "finish") finish = value;
      }
      if (reasoning) content.unshift({ type: "reasoning", text: reasoning });
      if (text) content.unshift({ type: "text", text });
      if (!finish) throw new Error("The model proxy ended without finishing.");
      const result: LanguageModelV4GenerateResult = {
        content,
        finishReason: finish.finishReason,
        usage: finish.usage,
        warnings: [],
      };
      return result;
    },
  };
}
