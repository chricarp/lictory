// JSON encoding of language model calls for the model proxy
// (`/api/runner/v1/sessions/:id/model`). The built-in harness runs the AI
// SDK's tool loop on the runner against a model whose calls the server
// executes with the organization's configured provider, so model keys never
// reach a runner. Call options and stream parts are plain data except for
// binary file contents, dates and errors, which are tagged here. Shared by
// the server and the runner; no dependencies.

const BYTES = "$lictoryBytes";
const DATE = "$lictoryDate";
const ERROR = "$lictoryError";

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeWire(value: unknown): unknown {
  if (value instanceof Uint8Array) return { [BYTES]: toBase64(value) };
  if (value instanceof Date) return { [DATE]: value.toISOString() };
  if (value instanceof Error) return { [ERROR]: value.message };
  if (value instanceof URL) return value.toString();
  if (Array.isArray(value)) return value.map(encodeWire);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      if (typeof entry !== "function" && entry !== undefined)
        out[key] = encodeWire(entry);
    return out;
  }
  return value;
}

export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[BYTES] === "string") return fromBase64(record[BYTES]);
    if (typeof record[DATE] === "string") return new Date(record[DATE]);
    if (typeof record[ERROR] === "string") return new Error(record[ERROR]);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record))
      out[key] = decodeWire(entry);
    return out;
  }
  return value;
}

// Fields of the call options the server accepts from a runner. Anything
// else (headers, provider-specific routing) is the server's to decide.
export const proxiedCallFields = [
  "prompt",
  "maxOutputTokens",
  "temperature",
  "stopSequences",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "responseFormat",
  "seed",
  "tools",
  "toolChoice",
  "includeRawChunks",
  "reasoning",
] as const;
