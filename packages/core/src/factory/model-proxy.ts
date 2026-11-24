import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from "@ai-sdk/provider";
import { aiProvider, languageModel } from "@lictory/core/ai/provider";
import { DomainError } from "@lictory/core/domain/errors";
import {
  decodeWire,
  encodeWire,
  proxiedCallFields,
} from "@lictory/core/factory/model-wire";

// The server half of the built-in harness's model calls
// (docs/internals/factory.md#model-proxy). The caller has already checked
// the lease, that the session is running and that Lictory Intelligence is
// enabled (`modelAccess`). The model is the organization's configured
// provider; its key stays on the server.

// A model call may run this long before the proxy gives up.
const CALL_TIMEOUT_MS = 10 * 60_000;

async function configured(): Promise<LanguageModelV4> {
  const config = aiProvider();
  if (!config)
    throw new DomainError(
      "unavailable",
      "This server has no AI provider configured.",
    );
  const model = await languageModel(config);
  if (typeof model === "string" || model.specificationVersion !== "v4")
    throw new DomainError(
      "unavailable",
      "The configured AI provider does not support the built-in harness.",
    );
  return model;
}

// Keeps only the call options a runner may set.
export function proxiedCall(raw: Record<string, unknown>) {
  const decoded = decodeWire(raw) as Record<string, unknown>;
  const call: Record<string, unknown> = {};
  for (const field of proxiedCallFields)
    if (decoded[field] !== undefined) call[field] = decoded[field];
  if (!Array.isArray(call.prompt))
    throw new DomainError("validation", "The model call has no prompt.");
  return call as unknown as Omit<
    LanguageModelV4CallOptions,
    "abortSignal" | "headers"
  >;
}

// Streams the model's parts as NDJSON lines (`encodeWire` of each part).
// A provider error becomes an `error` part, so the runner's tool loop sees
// it as the AI SDK would.
export async function proxyModelStream(
  rawCall: Record<string, unknown>,
  options: { signal?: AbortSignal; model?: LanguageModelV4 } = {},
): Promise<ReadableStream<Uint8Array>> {
  const call = proxiedCall(rawCall);
  const model = options.model ?? (await configured());
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const abortSignal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const encoder = new TextEncoder();
  const line = (value: unknown) =>
    encoder.encode(`${JSON.stringify(encodeWire(value))}\n`);
  let parts: ReadableStream<unknown>;
  try {
    ({ stream: parts } = await model.doStream({ ...call, abortSignal }));
  } catch (error) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(line({ type: "error", error: describe(error) }));
        controller.close();
      },
    });
  }
  const reader = parts.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        controller.enqueue(line(value));
      } catch (error) {
        controller.enqueue(line({ type: "error", error: describe(error) }));
        controller.close();
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

// Provider errors can carry request details; the runner gets the message.
function describe(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.slice(0, 2000));
}
