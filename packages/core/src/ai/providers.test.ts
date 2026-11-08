// Contract tests of every provider family against local fakes of its
// protocol, plus resolution rules for the providers added with the catalog.
// Mocked contracts only: they prove what Lictory sends and how it reads
// well-formed answers, not how a real provider or model behaves
// (`lictory ai check` does that).
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import {
  generateStructured,
  itemReviewOutput,
} from "@lictory/core/ai/analyzer";
import {
  entraToken,
  environmentState,
  guardedFetch,
  isMetadataAddress,
  languageModel,
  resolveText,
  resolveTranscriptionSettings,
  setAiState,
  type AiProviderConfig,
  type AiSettings,
  type TranscriptionConfig,
} from "@lictory/core/ai/provider";
import { checkAiProvider, syntheticWav } from "@lictory/core/ai/check";
import { mergeSettings } from "@lictory/core/ai/settings-input";
import {
  textProviderIds,
  textProviders,
  transcriptionProviderIds,
  transcriptionProviders,
  type TextProvider,
} from "@lictory/core/contracts/ai-provider";
import { transcribeSegment } from "@lictory/core/intelligence/voice/transcription";

type Seen = {
  path: string;
  headers: IncomingHttpHeaders;
  raw: string;
  body: Record<string, unknown>;
};
const servers: { close: () => void }[] = [];
after(() => servers.forEach((s) => s.close()));
async function fake(reply: (seen: Seen) => { status?: number; json: unknown }) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("latin1");
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // multipart
      }
      const entry = {
        path: new URL(request.url!, "http://fake").pathname,
        headers: request.headers,
        raw,
        body,
      };
      seen.push(entry);
      const answer = reply(entry);
      response
        .writeHead(answer.status ?? 200, { "Content-Type": "application/json" })
        .end(JSON.stringify(answer.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
  };
}

const configured = (source: Record<string, string>) => {
  const text = environmentState(source).text;
  assert.equal(text.state, "configured", JSON.stringify(text));
  return (text as { config: AiProviderConfig }).config;
};
const invalid = (source: Record<string, string>) => {
  const text = environmentState(source).text;
  assert.equal(text.state, "invalid", JSON.stringify(text));
  return (text as { problems: string[] }).problems.join("\n");
};

const review = {
  summary: "Retries lack failure behavior.",
  strengths: [],
  findings: [],
};
const request = {
  schema: itemReviewOutput,
  name: "item_review",
  system: "Review the item.",
  prompt: '{"items":[]}',
};
const structured = (config: AiProviderConfig) =>
  generateStructured({ model: languageModel(config), config }, request);
const chat = (content: string) => ({
  json: {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
});
const responses = (text: string) => ({
  json: {
    id: "resp_1",
    object: "response",
    status: "completed",
    created_at: 1,
    model: "m",
    output: [
      {
        type: "message",
        role: "assistant",
        id: "msg_1",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});

// ------------------------------------------------------------- catalog

void test("the catalog is complete: every provider has an adapter, a hint and a hosting", () => {
  for (const id of textProviderIds) {
    const p: TextProvider = textProviders[id];
    assert.ok(p.label && p.modelHint && p.protocol, id);
    assert.ok(Object.keys(p.fields).length > 0, id);
    if (p.hosting === "self-hosted" && id !== "openai-compatible")
      assert.match(p.defaultBaseUrl ?? "", /host\.docker\.internal/, id);
  }
  for (const id of transcriptionProviderIds)
    assert.ok(transcriptionProviders[id].label, id);
  // The major clouds and open-weight servers, for text and for dictation.
  for (const id of [
    "openai",
    "anthropic",
    "google",
    "vertex",
    "azure",
    "bedrock",
    "mistral",
    "xai",
    "groq",
    "deepseek",
    "openrouter",
    "ollama",
    "vllm",
    "lmstudio",
    "llamacpp",
  ])
    assert.ok(textProviderIds.includes(id as never), id);
  for (const id of [
    "openai-realtime",
    "openai",
    "azure",
    "vertex",
    "groq",
    "deepgram",
    "elevenlabs",
    "assemblyai",
    "mistral",
    "speaches",
    "whisper-cpp",
  ])
    assert.ok(transcriptionProviderIds.includes(id as never), id);
});

// ---------------------------------------------------------- resolution

void test("self-hosted presets need only a model; their server is on this machine by default", () => {
  const ollama = configured({
    LICTORY_AI_PROVIDER: "ollama",
    LICTORY_AI_MODEL: "qwen3:32b",
  });
  assert.equal(ollama.adapter, "openai-compatible");
  assert.equal(ollama.baseURL, "http://host.docker.internal:11434/v1");
  assert.equal(ollama.apiKey, undefined);
  assert.equal(
    configured({
      LICTORY_AI_PROVIDER: "vllm",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_BASE_URL: "http://gpu.internal:8000/v1",
    }).baseURL,
    "http://gpu.internal:8000/v1",
  );
  assert.match(
    invalid({ LICTORY_AI_PROVIDER: "ollama" }),
    /LICTORY_AI_MODEL is required for Ollama/,
  );
});

void test("Bedrock: a region, and one way to authenticate", () => {
  assert.match(
    invalid({ LICTORY_AI_PROVIDER: "bedrock", LICTORY_AI_MODEL: "m" }),
    /LICTORY_AI_REGION is required/,
  );
  assert.match(
    invalid({
      LICTORY_AI_PROVIDER: "bedrock",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_REGION: "eu-central-1",
      LICTORY_AI_AWS_ACCESS_KEY_ID: "AKIA",
    }),
    /go together/,
  );
  assert.match(
    invalid({
      LICTORY_AI_PROVIDER: "bedrock",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_REGION: "eu-central-1",
      LICTORY_AI_API_KEY: "k",
      LICTORY_AI_AWS_ACCESS_KEY_ID: "AKIA",
      LICTORY_AI_AWS_SECRET_ACCESS_KEY: "s",
    }),
    /either/,
  );
  // No key at all: the server's own AWS identity.
  const role = configured({
    LICTORY_AI_PROVIDER: "bedrock",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_REGION: "eu-central-1",
  });
  assert.equal(
    role.baseURL,
    "https://bedrock-runtime.eu-central-1.amazonaws.com",
  );
  assert.equal(role.keySetting, undefined);
});

void test("Vertex AI: an API key, a service account key, or the server's identity with project and location", () => {
  assert.match(
    invalid({ LICTORY_AI_PROVIDER: "vertex", LICTORY_AI_MODEL: "m" }),
    /LICTORY_AI_PROJECT is required/,
  );
  const express = configured({
    LICTORY_AI_PROVIDER: "vertex",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_API_KEY: "AIza-express",
  });
  assert.equal(express.project, undefined);
  const account = JSON.stringify({
    client_email: "a@p.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----",
    project_id: "acme-ai",
  });
  const service = configured({
    LICTORY_AI_PROVIDER: "vertex",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_API_KEY: account,
    LICTORY_AI_LOCATION: "europe-west4",
  });
  assert.equal(service.project, "acme-ai");
  assert.equal(service.apiKey, undefined);
  assert.equal(
    service.googleCredentials?.client_email,
    "a@p.iam.gserviceaccount.com",
  );
  assert.equal(
    service.baseURL,
    "https://europe-west4-aiplatform.googleapis.com",
  );
  assert.match(
    invalid({
      LICTORY_AI_PROVIDER: "vertex",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_API_KEY: "{not json",
    }),
    /not a valid one/,
  );
});

void test("dictation reuses the key of a text provider of the same vendor, never of another", () => {
  const settings: AiSettings = {
    text: { provider: "groq", apiKey: "gsk-text", model: "m" },
    transcription: { provider: "groq" },
  };
  const text = resolveText(settings, "console");
  const groq = resolveTranscriptionSettings(settings, text, "console");
  assert.equal(groq.state, "configured");
  assert.equal(
    (groq as { config: TranscriptionConfig }).config.apiKey,
    "gsk-text",
  );
  assert.equal(
    (groq as { config: TranscriptionConfig }).config.model,
    "whisper-large-v3-turbo",
  );
  const other = resolveTranscriptionSettings(
    { ...settings, transcription: { provider: "deepgram" } },
    text,
    "console",
  );
  assert.equal(other.state, "invalid");
  assert.match(
    (other as { problems: string[] }).problems.join(),
    /Dictation API key is required for Deepgram/,
  );
  // Azure dictation shares the resource endpoint too.
  const azure: AiSettings = {
    text: {
      provider: "azure",
      apiKey: "az",
      model: "gpt",
      baseUrl: "https://acme.openai.azure.com/openai/v1",
    },
    transcription: { provider: "azure", model: "whisper" },
  };
  const shared = resolveTranscriptionSettings(
    azure,
    resolveText(azure, "console"),
    "console",
  );
  assert.equal(
    (shared as { config: TranscriptionConfig }).config.baseURL,
    "https://acme.openai.azure.com/openai/v1",
  );
  // Self-hosted servers never share anything: different machines.
  const local: AiSettings = {
    text: { provider: "vllm", model: "m", apiKey: "vllm-key" },
    transcription: {
      provider: "speaches",
      model: "Systran/faster-whisper-large-v3",
    },
  };
  const speaches = resolveTranscriptionSettings(
    local,
    resolveText(local, "console"),
    "console",
  );
  assert.equal(
    (speaches as { config: TranscriptionConfig }).config.apiKey,
    undefined,
  );
  assert.equal(
    (speaches as { config: TranscriptionConfig }).config.mode,
    "segments",
  );
});

void test("the environment's dictation settings, and the live default only with OpenAI itself", () => {
  const live = environmentState({
    OPENAI_API_KEY: "sk",
    LICTORY_TRANSCRIPTION_MODEL: "gpt-live-x",
  }).transcription;
  assert.equal(
    (live as { config: TranscriptionConfig }).config.mode,
    "realtime",
  );
  assert.equal(
    (live as { config: TranscriptionConfig }).config.model,
    "gpt-live-x",
  );
  const whisper = environmentState({
    LICTORY_AI_PROVIDER: "ollama",
    LICTORY_AI_MODEL: "qwen3",
    LICTORY_TRANSCRIPTION_PROVIDER: "whisper-cpp",
    LICTORY_TRANSCRIPTION_BASE_URL: "http://whisper.internal:8080/v1",
  }).transcription;
  assert.equal(whisper.state, "configured");
  assert.equal(
    (whisper as { config: TranscriptionConfig }).config.baseURL,
    "http://whisper.internal:8080/v1",
  );
  assert.match(
    JSON.stringify(
      environmentState({
        OPENAI_API_KEY: "sk",
        LICTORY_TRANSCRIPTION_PROVIDER: "speech",
      }).transcription,
    ),
    /must be one of openai-realtime/,
  );
});

// ------------------------------------------------------ console settings

void test("saving keeps a stored key only for the same provider, and drops fields a provider has no use for", () => {
  const stored: AiSettings = {
    text: {
      provider: "anthropic",
      apiKey: "sk-ant-stored",
      model: "claude-sonnet-5-5",
    },
    transcription: { provider: "deepgram", apiKey: "dg-stored" },
  };
  const same = mergeSettings(stored, {
    text: { provider: "anthropic", model: "claude-opus-5-5" },
    transcription: { provider: "deepgram" },
  });
  assert.equal(same.text?.apiKey, "sk-ant-stored");
  assert.equal(same.transcription?.apiKey, "dg-stored");
  // Switching provider never carries the old key to the new vendor.
  const switched = mergeSettings(stored, {
    text: { provider: "mistral", model: "mistral-large-latest" },
    transcription: null,
  });
  assert.equal(switched.text?.apiKey, undefined);
  assert.equal(switched.transcription, null);
  // "" removes a stored key; fields of other providers are dropped.
  const cleared = mergeSettings(stored, {
    text: { provider: "anthropic", apiKey: "", region: "eu-central-1" },
    transcription: "default",
  });
  assert.equal(cleared.text?.apiKey, undefined);
  assert.equal(cleared.text?.region, undefined);
  assert.equal(cleared.transcription, undefined);
});

void test("console endpoints never reach instance metadata, even through DNS or redirects", async () => {
  for (const address of [
    "169.254.169.254",
    "fd00:ec2::254",
    "metadata.google.internal",
    "100.100.100.200",
    "fe80::1",
  ])
    assert.ok(isMetadataAddress(address), address);
  for (const address of ["10.0.0.5", "192.168.1.2", "ollama", "api.openai.com"])
    assert.ok(!isMetadataAddress(address), address);
  await assert.rejects(
    guardedFetch("http://169.254.169.254/latest/meta-data/"),
    /link-local or cloud metadata/,
  );
  await assert.rejects(
    guardedFetch("http://[fd00:ec2::254]/"),
    /link-local or cloud metadata/,
  );
  // A private model server is fine.
  const server = await fake(() => ({ json: { ok: true } }));
  const response = await guardedFetch(`${server.url}/v1/models`);
  assert.equal(response.status, 200);
  // A name that resolves to metadata is refused when connecting.
  await assert.rejects(
    guardedFetch("http://metadata.google.internal/computeMetadata/v1/"),
    /link-local or cloud metadata/,
  );
  // Multipart bodies (dictation clips) pass through the guard intact.
  const whisper = await fake((seen) => ({
    json: { text: seen.raw.includes('name="model"') ? "ok" : "no form" },
  }));
  const form = new FormData();
  form.append("model", "whisper");
  const posted = await guardedFetch(`${whisper.url}/v1/audio/transcriptions`, {
    method: "POST",
    body: form,
  });
  assert.deepEqual(await posted.json(), { text: "ok" });
  // A console-configured provider uses the guard.
  const config: AiProviderConfig = {
    ...configured({
      LICTORY_AI_PROVIDER: "openai-compatible",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_BASE_URL: "http://169.254.169.254/v1",
    }),
    source: "console",
  };
  await assert.rejects(
    structured(config),
    /link-local or cloud metadata|could not complete|could not reach/,
  );
});

// ---------------------------------------------------- text: wire contracts

void test("Google Gemini: generateContent with x-goog-api-key and a response schema", async () => {
  const server = await fake(() => ({
    json: {
      candidates: [
        {
          content: { role: "model", parts: [{ text: JSON.stringify(review) }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    },
  }));
  const config = configured({
    LICTORY_AI_PROVIDER: "google",
    LICTORY_AI_API_KEY: "AIza-contract",
    LICTORY_AI_MODEL: "gemini-3.8-flash",
    LICTORY_AI_BASE_URL: `${server.url}/v1beta`,
    OPENAI_API_KEY: "sk-never",
  });
  assert.deepEqual(await structured(config), review);
  const [seen] = server.seen;
  assert.equal(seen!.path, "/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(seen!.headers["x-goog-api-key"], "AIza-contract");
  assert.ok(
    JSON.stringify(seen!.body.generationConfig).includes("responseSchema") ||
      JSON.stringify(seen!.body.generationConfig).includes(
        "responseJsonSchema",
      ),
  );
  assert.ok(!JSON.stringify(seen!.headers).includes("sk-never"));
});

void test("Amazon Bedrock: Converse at the regional endpoint with a Bedrock API key", async () => {
  const server = await fake((seen) => {
    const tools = JSON.stringify(seen.body.toolConfig ?? {});
    return {
      json: {
        output: {
          message: {
            role: "assistant",
            content: tools.includes('"json"')
              ? [{ toolUse: { toolUseId: "t1", name: "json", input: review } }]
              : [{ text: JSON.stringify(review) }],
          },
        },
        stopReason: tools.includes('"json"') ? "tool_use" : "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    };
  });
  const config: AiProviderConfig = {
    ...configured({
      LICTORY_AI_PROVIDER: "bedrock",
      LICTORY_AI_MODEL: "amazon.nova-pro-v1:0",
      LICTORY_AI_REGION: "eu-central-1",
      LICTORY_AI_API_KEY: "bedrock-api-key",
    }),
    // A fake stands in for bedrock-runtime.<region>.amazonaws.com.
    baseURL: server.url,
    customBaseUrl: true,
  };
  assert.deepEqual(await structured(config), review);
  const [seen] = server.seen;
  assert.equal(
    decodeURIComponent(seen!.path),
    "/model/amazon.nova-pro-v1:0/converse",
  );
  assert.equal(seen!.headers.authorization, "Bearer bedrock-api-key");
});

for (const [provider, path, auth] of [
  ["mistral", "/v1/chat/completions", "Bearer mistral-key"],
  ["groq", "/openai/v1/chat/completions", "Bearer groq-key"],
  ["openrouter", "/api/v1/chat/completions", "Bearer openrouter-key"],
] as const)
  void test(`${textProviders[provider].label}: chat completions with its own key and a JSON schema`, async () => {
    const server = await fake(() => chat(JSON.stringify(review)));
    const base =
      provider === "groq"
        ? "/openai/v1"
        : provider === "openrouter"
          ? "/api/v1"
          : "/v1";
    const config: AiProviderConfig = {
      ...configured({
        LICTORY_AI_PROVIDER: provider,
        LICTORY_AI_API_KEY: auth.slice(7),
        LICTORY_AI_MODEL: "m",
        ...(provider === "openrouter"
          ? {}
          : { LICTORY_AI_BASE_URL: `${server.url}${base}` }),
      }),
      ...(provider === "openrouter"
        ? { baseURL: `${server.url}${base}`, customBaseUrl: true }
        : {}),
    };
    assert.deepEqual(await structured(config), review);
    const [seen] = server.seen;
    assert.equal(seen!.path, path);
    assert.equal(seen!.headers.authorization, auth);
    assert.match(
      JSON.stringify(seen!.body.response_format ?? {}),
      /json_schema|json_object/,
    );
  });

void test("xAI: the Responses API with its key", async () => {
  const server = await fake(() => responses(JSON.stringify(review)));
  const config = configured({
    LICTORY_AI_PROVIDER: "xai",
    LICTORY_AI_API_KEY: "xai-key",
    LICTORY_AI_MODEL: "grok-latest",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
  });
  assert.deepEqual(await structured(config), review);
  assert.equal(server.seen[0]!.path, "/v1/responses");
  assert.equal(server.seen[0]!.headers.authorization, "Bearer xai-key");
});

void test("DeepSeek: JSON mode with the schema written into the instructions", async () => {
  const server = await fake(() => chat(JSON.stringify(review)));
  const config = configured({
    LICTORY_AI_PROVIDER: "deepseek",
    LICTORY_AI_API_KEY: "ds-key",
    LICTORY_AI_MODEL: "deepseek-v4-flash",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
  });
  assert.equal(config.structuredOutput, "json-object");
  assert.deepEqual(await structured(config), review);
  const body = JSON.stringify(server.seen[0]!.body);
  assert.match(body, /JSON Schema/);
  assert.match(body, /findings/);
});

// ------------------------------------------------ dictation: wire contracts

const clipConfig = (source: Record<string, string>) => {
  const t = environmentState(source).transcription;
  assert.equal(t.state, "configured", JSON.stringify(t));
  return (t as { config: TranscriptionConfig }).config;
};

void test("a self-hosted Whisper server gets the clip as OpenAI-style multipart, never the OpenAI key", async () => {
  const server = await fake(() => ({
    json: { text: "Retry failed payments twice." },
  }));
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-real-openai-key";
  try {
    const config = clipConfig({
      LICTORY_AI_PROVIDER: "ollama",
      LICTORY_AI_MODEL: "qwen3",
      LICTORY_TRANSCRIPTION_PROVIDER: "speaches",
      LICTORY_TRANSCRIPTION_MODEL: "Systran/faster-whisper-large-v3",
      LICTORY_TRANSCRIPTION_BASE_URL: `${server.url}/v1`,
    });
    setAiState({
      ...environmentState({}),
      transcription: { state: "configured", config },
    });
    assert.deepEqual(await transcribeSegment(syntheticWav(), "audio/wav"), {
      text: "Retry failed payments twice.",
    });
    const [seen] = server.seen;
    assert.equal(seen!.path, "/v1/audio/transcriptions");
    assert.match(
      seen!.raw,
      /name="model"\r\n\r\nSystran\/faster-whisper-large-v3/,
    );
    assert.match(seen!.raw, /name="response_format"\r\n\r\njson/);
    assert.ok(!JSON.stringify(seen!.headers).includes("sk-real-openai-key"));
  } finally {
    setAiState(undefined);
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  }
});

void test("dictation clips are bounded and typed, and live mode refuses them", async () => {
  const config = clipConfig({
    OPENAI_API_KEY: "sk",
    LICTORY_TRANSCRIPTION_PROVIDER: "openai",
  });
  setAiState({
    ...environmentState({}),
    transcription: { state: "configured", config },
  });
  try {
    await assert.rejects(
      transcribeSegment(new Uint8Array(0), "audio/wav"),
      /between 0 and 30 seconds/,
    );
    await assert.rejects(
      transcribeSegment(new Uint8Array(2_000_000), "audio/wav"),
      /between 0 and 30 seconds/,
    );
    await assert.rejects(
      transcribeSegment(syntheticWav(), "text/plain"),
      /Unsupported audio format/,
    );
    const live = clipConfig({ OPENAI_API_KEY: "sk" });
    setAiState({
      ...environmentState({}),
      transcription: { state: "configured", config: live },
    });
    await assert.rejects(
      transcribeSegment(syntheticWav(), "audio/wav"),
      /dictates live audio/,
    );
  } finally {
    setAiState(undefined);
  }
});

void test("Azure and OpenAI transcription, and the check of a dictation provider", async () => {
  const server = await fake((seen) =>
    seen.path.endsWith("/audio/transcriptions")
      ? { json: { text: "" } }
      : chat(JSON.stringify(review)),
  );
  const azure = clipConfig({
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_API_KEY: "az-key",
    LICTORY_AI_MODEL: "gpt",
    LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
    LICTORY_TRANSCRIPTION_PROVIDER: "azure",
    LICTORY_TRANSCRIPTION_MODEL: "whisper",
  });
  assert.equal(azure.apiKey, "az-key");
  const report = await checkAiProvider({
    text: { state: "disabled" },
    transcription: {
      state: "configured",
      config: { ...azure, baseURL: `${server.url}/openai/v1` },
    },
  });
  assert.equal(report.dictation.ok, true, JSON.stringify(report.dictation));
  assert.match(report.dictation.checks[0]!.detail, /accepted a test clip/);
  assert.equal(server.seen[0]!.headers["api-key"], "az-key");
});

void test("Deepgram: the listen endpoint with its token", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; headers: Headers }[] = [];
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
    });
    return Response.json({
      metadata: { duration: 1 },
      results: {
        channels: [{ alternatives: [{ transcript: "Ship it.", words: [] }] }],
      },
    });
  };
  const config = clipConfig({
    OPENAI_API_KEY: "sk",
    LICTORY_TRANSCRIPTION_PROVIDER: "deepgram",
    LICTORY_TRANSCRIPTION_API_KEY: "dg-key",
  });
  setAiState({
    ...environmentState({}),
    transcription: { state: "configured", config },
  });
  try {
    assert.deepEqual(await transcribeSegment(syntheticWav(), "audio/wav"), {
      text: "Ship it.",
    });
    assert.match(
      calls[0]!.url,
      /^https:\/\/api\.deepgram\.com\/v1\/listen\?model=nova-3/,
    );
    assert.equal(calls[0]!.headers.get("authorization"), "Token dg-key");
  } finally {
    globalThis.fetch = original;
    setAiState(undefined);
  }
});

// ------------------------------------------------- review follow-ups

void test("Google speech refuses express-mode API keys and never inherits one", () => {
  const express = environmentState({
    LICTORY_AI_PROVIDER: "vertex",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_API_KEY: "AIza-express",
    LICTORY_TRANSCRIPTION_PROVIDER: "vertex",
  }).transcription;
  // Not inherited: speech needs a project and location (or a service account).
  assert.equal(express.state, "invalid");
  assert.match(
    JSON.stringify(express),
    /LICTORY_TRANSCRIPTION_PROJECT is required for Google Cloud Speech/,
  );
  const typed = environmentState({
    OPENAI_API_KEY: "sk",
    LICTORY_TRANSCRIPTION_PROVIDER: "vertex",
    LICTORY_TRANSCRIPTION_API_KEY: "AIza-express",
  }).transcription;
  assert.match(JSON.stringify(typed), /does not accept express-mode API keys/);
  const account = JSON.stringify({
    client_email: "a@p.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----",
    project_id: "acme",
  });
  const shared = environmentState({
    LICTORY_AI_PROVIDER: "vertex",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_API_KEY: account,
    LICTORY_AI_LOCATION: "europe-west4",
    LICTORY_TRANSCRIPTION_PROVIDER: "vertex",
  }).transcription;
  assert.equal(shared.state, "configured", JSON.stringify(shared));
});

void test("dictation of the same vendor goes through the language model's gateway", () => {
  const groq = environmentState({
    LICTORY_AI_PROVIDER: "groq",
    LICTORY_AI_API_KEY: "gsk",
    LICTORY_AI_MODEL: "m",
    LICTORY_AI_BASE_URL: "https://llm-gateway.corp.internal/groq/v1",
    LICTORY_TRANSCRIPTION_PROVIDER: "groq",
  }).transcription;
  const config = (groq as { config: TranscriptionConfig }).config;
  assert.equal(config.baseURL, "https://llm-gateway.corp.internal/groq/v1");
  assert.equal(config.customBaseUrl, true);
});

void test("Azure with Microsoft Entra ID: a service principal or the managed identity", async () => {
  const sp = configured({
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_MODEL: "gpt",
    LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
    LICTORY_AI_AZURE_TENANT_ID: "tenant-1",
    LICTORY_AI_AZURE_CLIENT_ID: "client-1",
    LICTORY_AI_AZURE_CLIENT_SECRET: "secret-1",
  });
  assert.deepEqual(sp.entra, {
    kind: "service-principal",
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: "secret-1",
  });
  const managed = configured({
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_MODEL: "gpt",
    LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
  });
  assert.deepEqual(managed.entra, {
    kind: "managed-identity",
    clientId: undefined,
  });
  assert.match(
    invalid({
      LICTORY_AI_PROVIDER: "azure",
      LICTORY_AI_MODEL: "gpt",
      LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
      LICTORY_AI_AZURE_CLIENT_SECRET: "secret-1",
    }),
    /all three/,
  );
  assert.match(
    invalid({
      LICTORY_AI_PROVIDER: "azure",
      LICTORY_AI_MODEL: "gpt",
      LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
      LICTORY_AI_API_KEY: "k",
      LICTORY_AI_AZURE_TENANT_ID: "t",
    }),
    /not both/,
  );
  // The client credentials flow, then the bearer token on Azure requests.
  const token: { url: string; body: string }[] = [];
  const issued = await entraToken(sp.entra, (async (
    url: string,
    init: RequestInit,
  ) => {
    token.push({ url, body: (init.body as URLSearchParams).toString() });
    return Response.json({ access_token: "entra-token-1", expires_in: 3600 });
  }) as unknown as typeof fetch);
  assert.equal(issued, "entra-token-1");
  assert.equal(
    token[0]!.url,
    "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token",
  );
  assert.match(token[0]!.body, /grant_type=client_credentials/);
  assert.match(
    token[0]!.body,
    /scope=https%3A%2F%2Fcognitiveservices\.azure\.com%2F\.default/,
  );
  const server = await fake(() => responses(JSON.stringify(review)));
  // The token is cached: the adapter uses it without another sign-in.
  assert.deepEqual(
    await structured({ ...sp, baseURL: `${server.url}/openai/v1` }),
    review,
  );
  assert.equal(server.seen[0]!.headers.authorization, "Bearer entra-token-1");
  assert.equal(server.seen[0]!.headers["api-key"], undefined);
  // A refused service principal says what to check, never the secret.
  await assert.rejects(
    entraToken(
      {
        kind: "service-principal",
        tenantId: "t2",
        clientId: "c2",
        clientSecret: "s3cr3t",
      },
      async () => new Response("{}", { status: 401 }),
    ),
    (e: Error) =>
      e.message.includes("Check the tenant ID") &&
      !e.message.includes("s3cr3t"),
  );
});

void test("Groq and Mistral dictation: multipart clips with their keys", async () => {
  for (const [provider, path, auth] of [
    ["groq", "/openai/v1/audio/transcriptions", "Bearer gsk-key"],
    ["mistral", "/v1/audio/transcriptions", "Bearer mistral-key"],
  ] as const) {
    // Each provider's own response shape (Groq names its request, Mistral its model).
    const server = await fake(() => ({
      json: {
        text: "Ship it.",
        x_groq: { id: "req_1" },
        model: "voxtral-mini-latest",
      },
    }));
    const config = clipConfig({
      OPENAI_API_KEY: "sk",
      LICTORY_TRANSCRIPTION_PROVIDER: provider,
      LICTORY_TRANSCRIPTION_API_KEY: auth.slice(7),
      LICTORY_TRANSCRIPTION_BASE_URL: `${server.url}${path.replace("/audio/transcriptions", "")}`,
    });
    setAiState({
      ...environmentState({}),
      transcription: { state: "configured", config },
    });
    try {
      assert.deepEqual(await transcribeSegment(syntheticWav(), "audio/wav"), {
        text: "Ship it.",
      });
      assert.equal(server.seen[0]!.path, path, provider);
      assert.equal(server.seen[0]!.headers.authorization, auth);
    } finally {
      setAiState(undefined);
    }
  }
});

void test("ElevenLabs and AssemblyAI dictation: their APIs and keys", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; headers: Headers }[] = [];
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.includes("elevenlabs"))
      return Response.json({
        language_code: "en",
        language_probability: 1,
        text: "Ship it.",
        words: [],
      });
    if (url.endsWith("/v2/upload"))
      return Response.json({ upload_url: "https://cdn.assemblyai.test/clip" });
    if (url.endsWith("/v2/transcript"))
      return Response.json({ id: "t1", status: "queued" });
    return Response.json({
      id: "t1",
      status: "completed",
      text: "Ship it.",
      words: [],
      audio_duration: 1,
    });
  };
  try {
    for (const [provider, key, host, header, value] of [
      [
        "elevenlabs",
        "el-key",
        "https://api.elevenlabs.io/v1/speech-to-text",
        "xi-api-key",
        "el-key",
      ],
      [
        "assemblyai",
        "aai-key",
        "https://api.assemblyai.com/v2/upload",
        "authorization",
        "aai-key",
      ],
    ] as const) {
      calls.length = 0;
      const config = clipConfig({
        OPENAI_API_KEY: "sk",
        LICTORY_TRANSCRIPTION_PROVIDER: provider,
        LICTORY_TRANSCRIPTION_API_KEY: key,
      });
      setAiState({
        ...environmentState({}),
        transcription: { state: "configured", config },
      });
      assert.deepEqual(
        await transcribeSegment(syntheticWav(), "audio/wav"),
        { text: "Ship it." },
        provider,
      );
      assert.ok(calls[0]!.url.startsWith(host), calls[0]!.url);
      assert.equal(calls[0]!.headers.get(header), value);
    }
  } finally {
    globalThis.fetch = original;
    setAiState(undefined);
  }
});

void test("Vertex AI: generateContent with an express-mode key and a response schema", async () => {
  const server = await fake(() => ({
    json: {
      candidates: [
        {
          content: { role: "model", parts: [{ text: JSON.stringify(review) }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    },
  }));
  const config: AiProviderConfig = {
    ...configured({
      LICTORY_AI_PROVIDER: "vertex",
      LICTORY_AI_MODEL: "gemini-3.8-flash",
      LICTORY_AI_API_KEY: "vertex-express-key",
    }),
    // A fake stands in for aiplatform.googleapis.com/v1/publishers/google.
    baseURL: `${server.url}/v1/publishers/google`,
    customBaseUrl: true,
  };
  assert.deepEqual(await structured(config), review);
  const [seen] = server.seen;
  assert.equal(
    seen!.path,
    "/v1/publishers/google/models/gemini-3.8-flash:generateContent",
  );
  assert.equal(seen!.headers["x-goog-api-key"], "vertex-express-key");
  assert.match(
    JSON.stringify(seen!.body.generationConfig),
    /response(Json)?Schema/,
  );
});

// ------------------------------------------------- second review follow-ups

void test("dictation signs in with its own credentials or all of the language model's, never a mix", () => {
  const base = {
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_MODEL: "gpt",
    LICTORY_AI_BASE_URL: "https://acme.openai.azure.com/openai/v1",
    LICTORY_TRANSCRIPTION_PROVIDER: "azure",
    LICTORY_TRANSCRIPTION_MODEL: "whisper",
  };
  // Text with a service principal, dictation with its own key.
  const own = clipConfig({
    ...base,
    LICTORY_AI_AZURE_TENANT_ID: "t",
    LICTORY_AI_AZURE_CLIENT_ID: "c",
    LICTORY_AI_AZURE_CLIENT_SECRET: "s",
    LICTORY_TRANSCRIPTION_API_KEY: "speech-key",
  });
  assert.equal(own.apiKey, "speech-key");
  assert.equal(own.entra, undefined);
  // Text with a key, dictation with its own service principal.
  const principal = clipConfig({
    ...base,
    LICTORY_AI_API_KEY: "text-key",
    LICTORY_TRANSCRIPTION_AZURE_TENANT_ID: "t2",
    LICTORY_TRANSCRIPTION_AZURE_CLIENT_ID: "c2",
    LICTORY_TRANSCRIPTION_AZURE_CLIENT_SECRET: "s2",
  });
  assert.equal(principal.apiKey, undefined);
  assert.deepEqual(principal.entra, {
    kind: "service-principal",
    tenantId: "t2",
    clientId: "c2",
    clientSecret: "s2",
  });
  // Nothing of its own: the language model's whole bundle.
  const shared = clipConfig({
    ...base,
    LICTORY_AI_AZURE_TENANT_ID: "t",
    LICTORY_AI_AZURE_CLIENT_ID: "c",
    LICTORY_AI_AZURE_CLIENT_SECRET: "s",
  });
  assert.equal(shared.entra?.kind, "service-principal");
});

void test("a rotated client secret never reuses the previous token", async () => {
  let calls = 0;
  const issue = (async () => {
    calls++;
    return Response.json({ access_token: `token-${calls}`, expires_in: 3600 });
  }) as unknown as typeof fetch;
  const first = await entraToken(
    {
      kind: "service-principal",
      tenantId: "rot",
      clientId: "c",
      clientSecret: "old",
    },
    issue,
  );
  const again = await entraToken(
    {
      kind: "service-principal",
      tenantId: "rot",
      clientId: "c",
      clientSecret: "old",
    },
    issue,
  );
  const rotated = await entraToken(
    {
      kind: "service-principal",
      tenantId: "rot",
      clientId: "c",
      clientSecret: "new",
    },
    issue,
  );
  assert.equal(first, again);
  assert.notEqual(rotated, first);
  assert.equal(calls, 2);
});

void test("the check fails when dictation is misconfigured, and passes when it is deliberately off", async () => {
  const server = await fake(() => chat(JSON.stringify(review)));
  const config = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
    LICTORY_AI_MODEL: "m",
  });
  // Text alone: the streamed tool call fails against this fake, so only the
  // verdict's dependence on dictation is asserted.
  const invalid = await checkAiProvider({
    text: { state: "configured", config },
    transcription: {
      state: "invalid",
      problems: ["Dictation API key is required."],
    },
  });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.dictation.problems, [
    "Dictation API key is required.",
  ]);
});

void test("speech failures name dictation's own settings", async () => {
  const server = await fake(() => ({
    status: 404,
    json: { error: { message: "model not found" } },
  }));
  const config = clipConfig({
    LICTORY_AI_PROVIDER: "ollama",
    LICTORY_AI_MODEL: "qwen3",
    LICTORY_TRANSCRIPTION_PROVIDER: "speaches",
    LICTORY_TRANSCRIPTION_MODEL: "missing-whisper",
    LICTORY_TRANSCRIPTION_BASE_URL: `${server.url}/v1`,
  });
  setAiState({
    ...environmentState({}),
    transcription: { state: "configured", config },
  });
  try {
    await assert.rejects(
      transcribeSegment(syntheticWav(), "audio/wav"),
      (e: Error) =>
        e.message.includes("LICTORY_TRANSCRIPTION_MODEL") &&
        e.message.includes("LICTORY_TRANSCRIPTION_BASE_URL") &&
        !e.message.includes("LICTORY_AI_MODEL"),
    );
  } finally {
    setAiState(undefined);
  }
});
