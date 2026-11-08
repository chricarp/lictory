// Provider selection, configuration validation, and contract tests of each
// protocol against local fakes. These are mocked contracts: they prove what
// Lictory sends and how it reads well-formed answers, not that a real
// provider or model behaves this way (`lictory admin ai-check` does that).
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { APICallError } from "ai";
import {
  analyzerTarget,
  describeProviderError,
  generateStructured,
  itemReviewOutput,
} from "@lictory/core/ai/analyzer";
import {
  aiProviderRule,
  describeAiProvider,
  languageModel,
  providerFingerprint,
  resolveAiProvider,
  resolveTranscription,
  type AiProviderConfig,
} from "@lictory/core/ai/provider";
import { checkAiProvider } from "@lictory/core/ai/check";
import { checkConfiguration } from "@lictory/core/config/validate";
import { aiRules } from "@lictory/core/config/ai";
import {
  continuedBy,
  replayableMessages,
} from "@lictory/core/intelligence/chat/replay";
import type { ChatMessage } from "@lictory/core/intelligence/chat/shared";

const configured = (source: Record<string, string>) => {
  const resolved = resolveAiProvider(source);
  assert.equal(resolved.state, "configured", JSON.stringify(resolved));
  return (resolved as { config: AiProviderConfig }).config;
};
const problems = (source: Record<string, string>) => {
  const resolved = resolveAiProvider(source);
  assert.equal(resolved.state, "invalid", JSON.stringify(resolved));
  return (resolved as { problems: string[] }).problems.join("\n");
};

// ------------------------------------------------------------- selection

void test("existing installations: an OpenAI key alone selects OpenAI, nothing selects nothing", () => {
  assert.deepEqual(resolveAiProvider({}), { state: "disabled" });
  assert.deepEqual(
    resolveAiProvider({ OPENAI_API_KEY: " ", LICTORY_AI_MODEL: "gpt-x" }),
    { state: "disabled" },
  );
  const legacy = configured({ OPENAI_API_KEY: "sk-legacy" });
  assert.equal(legacy.provider, "openai");
  assert.equal(legacy.model, "gpt-6-luna");
  assert.equal(legacy.baseURL, "https://api.openai.com/v1");
  assert.equal(legacy.keySetting, "OPENAI_API_KEY");
  // The SDK's own OPENAI_BASE_URL keeps working.
  assert.equal(
    configured({
      OPENAI_API_KEY: "sk-legacy",
      OPENAI_BASE_URL: "http://gateway.internal:8080/v1/",
    }).baseURL,
    "http://gateway.internal:8080/v1",
  );
  // Compose forwards unset variables as empty strings.
  assert.equal(
    configured({ OPENAI_API_KEY: "sk", LICTORY_AI_PROVIDER: "" }).provider,
    "openai",
  );
});

void test("each provider needs its own complete settings, and nothing is guessed", () => {
  assert.match(
    problems({ LICTORY_AI_PROVIDER: "llama" }),
    /must be one of openai, anthropic, google, vertex, azure, bedrock/,
  );
  // New settings without a provider are not silently sent to OpenAI.
  assert.match(
    problems({
      OPENAI_API_KEY: "sk",
      LICTORY_AI_BASE_URL: "http://inference.internal:8000/v1",
    }),
    /LICTORY_AI_PROVIDER is not/,
  );
  const anthropic = problems({ LICTORY_AI_PROVIDER: "anthropic" });
  assert.match(anthropic, /LICTORY_AI_API_KEY is required/);
  assert.match(anthropic, /LICTORY_AI_MODEL is required/);
  // Another provider never borrows the OpenAI key.
  assert.match(
    problems({
      LICTORY_AI_PROVIDER: "anthropic",
      LICTORY_AI_MODEL: "claude-test",
      OPENAI_API_KEY: "sk-openai",
    }),
    /LICTORY_AI_API_KEY is required/,
  );
  const azure = problems({
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_API_KEY: "k",
  });
  assert.match(azure, /deployment/);
  assert.match(azure, /LICTORY_AI_BASE_URL is required/);
  assert.match(
    problems({
      LICTORY_AI_PROVIDER: "azure",
      LICTORY_AI_API_KEY: "k",
      LICTORY_AI_MODEL: "prod",
      LICTORY_AI_BASE_URL: "http://example.openai.azure.com/openai/v1",
    }),
    /must be an https URL/,
  );
  assert.match(
    problems({
      LICTORY_AI_PROVIDER: "openai-compatible",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_BASE_URL: "http://user:secret@inference.internal/v1",
    }),
    /must not contain credentials/,
  );
  assert.match(
    problems({
      LICTORY_AI_PROVIDER: "openai",
      LICTORY_AI_API_KEY: "sk",
      LICTORY_AI_STRUCTURED_OUTPUT: "json-object",
    }),
    /applies only to self-hosted and OpenAI-compatible endpoints/,
  );
  assert.match(
    problems({ OPENAI_API_KEY: "sk", LICTORY_AI_TIMEOUT_SECONDS: "5" }),
    /from 30 to 480/,
  );
});

void test("a keyless self-hosted endpoint is a complete configuration", () => {
  const local = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: "http://host.docker.internal:11434/v1",
    LICTORY_AI_MODEL: "qwen3:32b",
    // Present for dictation; never used for the local endpoint.
    OPENAI_API_KEY: "sk-openai",
  });
  assert.equal(local.apiKey, undefined);
  assert.equal(local.baseURL, "http://host.docker.internal:11434/v1");
  assert.equal(local.structuredOutput, "json-schema");
  assert.equal(
    configured({
      LICTORY_AI_PROVIDER: "openai-compatible",
      LICTORY_AI_BASE_URL: "http://vllm:8000/v1",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_STRUCTURED_OUTPUT: "json-object",
      LICTORY_AI_TIMEOUT_SECONDS: "480",
    }).timeoutMs,
    480_000,
  );
  const anthropic = configured({
    LICTORY_AI_PROVIDER: "anthropic",
    LICTORY_AI_API_KEY: "k",
    LICTORY_AI_MODEL: "claude-test",
  });
  assert.equal(anthropic.baseURL, "https://api.anthropic.com/v1");
  assert.equal(anthropic.keySetting, "LICTORY_AI_API_KEY");
});

void test("startup: invalid selections stop the API and worker; risky ones warn", () => {
  const base = { NODE_ENV: "production" };
  const invalid = checkConfiguration(
    "worker",
    { LICTORY_AI_PROVIDER: "azure" },
    aiRules,
  );
  const ai = invalid.problems.filter((p) => p.includes("Lictory Intelligence"));
  assert.equal(ai.length, 1, invalid.problems.join("\n"));
  assert.match(
    ai[0]!,
    /misconfigured: LICTORY_AI_BASE_URL is required for Azure OpenAI/,
  );
  // An unknown provider is also caught by the declaration's choice check.
  assert.ok(
    checkConfiguration("api", { LICTORY_AI_PROVIDER: "x" }, aiRules).problems
      .length >= 1,
  );
  const loopback = aiProviderRule({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: "http://localhost:11434/v1",
    LICTORY_AI_MODEL: "m",
  });
  assert.match(
    (loopback as { warning: string }).warning,
    /Inside a container that is the container itself/,
  );
  const publicHttp = aiProviderRule({
    ...base,
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: "http://inference.example.com/v1",
    LICTORY_AI_MODEL: "m",
  });
  assert.match((publicHttp as { warning: string }).warning, /unencrypted/);
  for (const host of [
    "http://10.0.4.2:8000/v1",
    "http://ollama:11434/v1",
    "http://gpu.corp.internal/v1",
    "http://host.docker.internal:11434/v1",
  ])
    assert.equal(
      aiProviderRule({
        ...base,
        LICTORY_AI_PROVIDER: "openai-compatible",
        LICTORY_AI_BASE_URL: host,
        LICTORY_AI_MODEL: "m",
      }),
      undefined,
      host,
    );
  // No AI at all is not a problem.
  assert.equal(aiProviderRule({}), undefined);
});

void test("dictation: on with OpenAI itself, otherwise only by explicit choice", () => {
  assert.equal(
    resolveTranscription({ OPENAI_API_KEY: "sk" }).state,
    "configured",
  );
  // A gateway in front of OpenAI does not imply sending audio to OpenAI.
  assert.equal(
    resolveTranscription({
      OPENAI_API_KEY: "sk",
      OPENAI_BASE_URL: "https://gateway.internal/v1",
    }).state,
    "disabled",
  );
  const local = {
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: "http://ollama:11434/v1",
    LICTORY_AI_MODEL: "m",
  };
  assert.equal(resolveTranscription(local).state, "disabled");
  assert.match(
    JSON.stringify(
      aiProviderRule({
        ...local,
        LICTORY_TRANSCRIPTION_PROVIDER: "openai-realtime",
      }),
    ),
    /LICTORY_TRANSCRIPTION_API_KEY is required for OpenAI Realtime/,
  );
  const chosen = resolveTranscription({
    ...local,
    LICTORY_TRANSCRIPTION_PROVIDER: "openai-realtime",
    OPENAI_API_KEY: "sk-audio",
  });
  assert.equal(chosen.state, "configured");
  const config = (
    chosen as { config: { apiKey: string; baseURL: string; mode: string } }
  ).config;
  assert.equal(config.apiKey, "sk-audio");
  assert.equal(config.baseURL, "https://api.openai.com/v1");
  assert.equal(config.mode, "realtime");
  assert.equal(
    resolveTranscription({
      OPENAI_API_KEY: "sk",
      LICTORY_TRANSCRIPTION_PROVIDER: "none",
    }).state,
    "disabled",
  );
});

void test("the admin description names the endpoint and key setting, never the key", () => {
  const description = describeAiProvider({
    LICTORY_AI_PROVIDER: "anthropic",
    LICTORY_AI_API_KEY: "sk-ant-secret-value",
    LICTORY_AI_MODEL: "claude-test",
    LICTORY_AI_BASE_URL: "https://example.services.ai.azure.com/anthropic/v1",
  });
  assert.equal(description.state, "configured");
  assert.ok(!JSON.stringify(description).includes("secret-value"));
  assert.equal(description.keySetting, "LICTORY_AI_API_KEY");
  assert.equal(
    description.endpoint,
    "https://example.services.ai.azure.com/anthropic/v1",
  );
});

// --------------------------------------------------------- error messages

const failure = (statusCode: number | undefined, responseBody = "") =>
  new APICallError({
    message: "Bad Request",
    url: "http://endpoint/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
const local: Pick<AiProviderConfig, "provider" | "baseURL" | "keySetting"> = {
  provider: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
};

void test("failures name the setting to check and the protocol gap, never the body", () => {
  assert.match(
    describeProviderError(failure(undefined), "Retry", local),
    /localhost, which inside a container is the container itself/,
  );
  assert.match(
    describeProviderError(
      failure(
        400,
        '{"error":"registry.ollama.ai/library/gemma3:4b does not support tools"}',
      ),
      "Retry",
      local,
    ),
    /does not support tool calls/,
  );
  assert.match(
    describeProviderError(
      failure(
        400,
        '{"error":{"message":"response_format json_schema is not supported"}}',
      ),
      "Retry",
      local,
    ),
    /LICTORY_AI_STRUCTURED_OUTPUT=json-object/,
  );
  assert.match(
    describeProviderError(
      failure(400, "This model's maximum context length is 8192 tokens"),
      "Retry",
      local,
    ),
    /longer than the AI model accepts/,
  );
  assert.match(
    describeProviderError(failure(401), "Retry", {
      provider: "anthropic",
      baseURL: "https://api.anthropic.com/v1",
      keySetting: "LICTORY_AI_API_KEY",
    }),
    /check LICTORY_AI_API_KEY/,
  );
  assert.match(
    describeProviderError(failure(404), "Retry", {
      provider: "azure",
      baseURL: "https://x.openai.azure.com/openai/v1",
      keySetting: "LICTORY_AI_API_KEY",
    }),
    /deployment name/,
  );
  // An unrelated 400 that mentions a tool is not reported as missing support.
  assert.doesNotMatch(
    describeProviderError(
      failure(400, "Invalid schema for function 'lookup': secret detail"),
      "Retry",
      local,
    ),
    /does not support tool calls|secret/,
  );
});

// -------------------------------------------------------- chat replay

void test("earlier turns from another provider are replayed without its reasoning or metadata", () => {
  const openai = {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
  } as const;
  const anthropic = {
    provider: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
  } as const;
  const messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Hi" }] },
    {
      id: "a1",
      role: "assistant",
      // Written before fingerprints were recorded: OpenAI.
      parts: [
        {
          type: "reasoning",
          text: "…",
          providerMetadata: {
            openai: { itemId: "rs_1", reasoningEncryptedContent: "enc" },
          },
        },
        {
          type: "tool-getWorkItem",
          toolCallId: "call_1",
          state: "output-available",
          input: { key: "PAY-1" },
          output: { title: "Retry" },
          callProviderMetadata: { openai: { itemId: "fc_1" } },
        },
        {
          type: "text",
          text: "PAY-1 is about retries.",
          providerMetadata: { openai: { itemId: "msg_1" } },
        },
      ],
    },
  ] as unknown as ChatMessage[];
  // The same provider sees its own history unchanged.
  assert.deepEqual(
    replayableMessages(messages, providerFingerprint(openai)),
    messages,
  );
  const sent = replayableMessages(messages, providerFingerprint(anthropic));
  const parts = sent[1]!.parts as unknown as Record<string, unknown>[];
  assert.deepEqual(
    parts.map((p) => p.type),
    ["tool-getWorkItem", "text"],
  );
  assert.ok(
    parts.every(
      (p) => !("providerMetadata" in p) && !("callProviderMetadata" in p),
    ),
  );
  // Tool calls and their results stay paired.
  assert.equal(parts[0]!.toolCallId, "call_1");
  assert.deepEqual(parts[0]!.output, { title: "Retry" });
  // The stored transcript is not modified.
  assert.equal(messages[1]!.parts.length, 3);
  // A message stamped by the current provider keeps everything.
  const stamped = [
    {
      ...messages[1]!,
      metadata: { generatedBy: providerFingerprint(anthropic) },
    },
  ];
  assert.deepEqual(
    replayableMessages(stamped, providerFingerprint(anthropic)),
    stamped,
  );
  // Reasoning whose metadata is absent, even as an empty key, is left out.
  const bare = [
    {
      ...stamped[0]!,
      parts: [
        { type: "reasoning", text: "…", providerMetadata: undefined },
        { type: "text", text: "Done." },
      ],
    },
  ] as unknown as ChatMessage[];
  assert.deepEqual(
    replayableMessages(bare, providerFingerprint(anthropic))[0]!.parts.map(
      (p) => p.type,
    ),
    ["text"],
  );
});

// ------------------------------------------------- protocol contract fakes

type Seen = {
  method: string;
  path: string;
  query: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
};
type Reply = { json: unknown; status?: number } | { sse: unknown[] };

const servers: { close: () => void }[] = [];
after(() => servers.forEach((s) => s.close()));

async function fake(reply: (seen: Seen) => Reply) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    request.on("end", () => {
      const url = new URL(request.url!, "http://fake");
      const entry: Seen = {
        method: request.method!,
        path: url.pathname,
        query: url.search,
        headers: request.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      seen.push(entry);
      const answer = reply(entry);
      if ("sse" in answer) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const event of answer.sse)
          response.write(
            `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
          );
        response.end();
        return;
      }
      response
        .writeHead(answer.status ?? 200, { "Content-Type": "application/json" })
        .end(JSON.stringify(answer.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
}

const review = {
  summary: "Retries lack failure behavior.",
  strengths: [],
  findings: [],
};
const reviewRequest = {
  schema: itemReviewOutput,
  name: "item_review",
  system: "Review the item.",
  prompt: '{"items":[]}',
};
const target = (config: AiProviderConfig) => ({
  model: languageModel(config),
  config,
});
const responsesAnswer = (text: string) => ({
  json: {
    id: "resp_1",
    created_at: 1,
    model: "m",
    output: [
      {
        type: "message",
        role: "assistant",
        id: "msg_1",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});
const chatAnswer = (content: string) => ({
  json: {
    id: "chatcmpl-1",
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

void test("OpenAI (existing configuration): Responses API, bearer key, asked not to store", async () => {
  const server = await fake(() => responsesAnswer(JSON.stringify(review)));
  const config = configured({
    OPENAI_API_KEY: "sk-contract",
    OPENAI_BASE_URL: `${server.url}/v1`,
  });
  assert.deepEqual(
    await generateStructured(target(config), reviewRequest),
    review,
  );
  const [request] = server.seen;
  assert.equal(request!.path, "/v1/responses");
  assert.equal(request!.headers.authorization, "Bearer sk-contract");
  assert.equal(request!.body.store, false);
  assert.equal(
    (request!.body.text as { format: { type: string } }).format.type,
    "json_schema",
  );
});

void test("Anthropic (or Claude in Azure AI Foundry): Messages API with x-api-key", async () => {
  const server = await fake((seen) => {
    // Older models get the schema as a forced `json` tool, newer ones a
    // native output format; either way the answer is the review JSON.
    const tools = (seen.body.tools as { name: string }[] | undefined) ?? [];
    return {
      json: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-test",
        content: tools.some((t) => t.name === "json")
          ? [{ type: "tool_use", id: "toolu_1", name: "json", input: review }]
          : [{ type: "text", text: JSON.stringify(review) }],
        stop_reason: tools.length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
  });
  const config = configured({
    LICTORY_AI_PROVIDER: "anthropic",
    LICTORY_AI_API_KEY: "sk-ant-contract",
    LICTORY_AI_MODEL: "claude-test",
    LICTORY_AI_BASE_URL: `${server.url}/anthropic/v1`,
    OPENAI_API_KEY: "sk-openai-never-sent",
  });
  assert.deepEqual(
    await generateStructured(target(config), reviewRequest),
    review,
  );
  const [request] = server.seen;
  assert.equal(request!.path, "/anthropic/v1/messages");
  assert.equal(request!.headers["x-api-key"], "sk-ant-contract");
  assert.ok(request!.headers["anthropic-version"]);
  assert.equal(request!.headers.authorization, undefined);
  assert.equal(request!.body.model, "claude-test");
  assert.ok(!JSON.stringify(request!.headers).includes("sk-openai"));
});

void test("Azure OpenAI: the deployment at the configured v1 endpoint, api-key header, asked not to store", async () => {
  const server = await fake(() => responsesAnswer(JSON.stringify(review)));
  const config = configured({
    LICTORY_AI_PROVIDER: "azure",
    LICTORY_AI_API_KEY: "azure-contract-key",
    LICTORY_AI_MODEL: "lictory-prod",
    // Real endpoints are https://<resource>.openai.azure.com/openai/v1; a
    // local fake cannot serve that name, so this checks the path suffix,
    // header and body (the SDK adds api-version only for Azure host names).
    LICTORY_AI_BASE_URL: `${server.url.replace("http:", "https:")}/openai/v1`,
  });
  // https is required for Azure; the fake speaks http.
  const model = languageModel({
    ...config,
    baseURL: `${server.url}/openai/v1`,
  });
  assert.deepEqual(
    await generateStructured({ model, config }, reviewRequest),
    review,
  );
  const [request] = server.seen;
  assert.equal(request!.path, "/openai/v1/responses");
  assert.equal(request!.headers["api-key"], "azure-contract-key");
  assert.equal(request!.body.model, "lictory-prod");
  // Azure stores Responses by default; Lictory asks it not to.
  assert.equal(request!.body.store, false);
});

void test("OpenAI-compatible, json-schema: Chat Completions with the schema and no key", async () => {
  const server = await fake(() => chatAnswer(JSON.stringify(review)));
  const config = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
    LICTORY_AI_MODEL: "llama-local",
    OPENAI_API_KEY: "sk-openai-never-sent",
  });
  assert.deepEqual(
    await generateStructured(target(config), reviewRequest),
    review,
  );
  const [request] = server.seen;
  assert.equal(request!.path, "/v1/chat/completions");
  assert.equal(request!.headers.authorization, undefined);
  const format = request!.body.response_format as {
    type: string;
    json_schema: { schema: { properties: Record<string, unknown> } };
  };
  assert.equal(format.type, "json_schema");
  assert.ok(format.json_schema.schema.properties.findings);
});

void test("OpenAI-compatible, json-object: JSON mode with the schema in the instructions, still validated", async () => {
  let answer = JSON.stringify(review);
  const server = await fake(() => chatAnswer(answer));
  const config = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
    LICTORY_AI_MODEL: "llama-local",
    LICTORY_AI_API_KEY: "local-gateway-key",
    LICTORY_AI_STRUCTURED_OUTPUT: "json-object",
  });
  assert.deepEqual(
    await generateStructured(target(config), reviewRequest),
    review,
  );
  const [request] = server.seen;
  assert.equal(request!.headers.authorization, "Bearer local-gateway-key");
  assert.deepEqual(request!.body.response_format, { type: "json_object" });
  const [system] = request!.body.messages as {
    role: string;
    content: string;
  }[];
  assert.equal(system!.role, "system");
  assert.match(system!.content, /JSON Schema/);
  assert.match(system!.content, /"findings"/);
  // An answer that does not match the schema is rejected, not trusted.
  answer = JSON.stringify({ summary: "no findings field" });
  await assert.rejects(
    generateStructured(target(config), reviewRequest),
    /did not return a valid result/,
  );
});

// The SDK retries twice with backoff before it gives up.
void test(
  "no fallback: a failing private endpoint fails without contacting another provider",
  { timeout: 30_000 },
  async () => {
    const openai = await fake(() => responsesAnswer(JSON.stringify(review)));
    const config = configured({
      LICTORY_AI_PROVIDER: "openai-compatible",
      // Nothing listens on port 9 here.
      LICTORY_AI_BASE_URL: "http://127.0.0.1:9/v1",
      LICTORY_AI_MODEL: "m",
      OPENAI_API_KEY: "sk-openai",
      OPENAI_BASE_URL: `${openai.url}/v1`,
    });
    await assert.rejects(
      generateStructured({ ...target(config) }, reviewRequest, {}, "Retry"),
      /could not reach the AI provider\. Retry later.*container itself/,
    );
    assert.equal(openai.seen.length, 0);
  },
);

// The streamed tool call of Litto as an OpenAI-compatible server sends it.
const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const toolCallStream = {
  sse: [
    chunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "lookupWorkItem", arguments: '{"key":' },
        },
      ],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"DEMO-1"}' } }] }),
    chunk({}, "tool_calls"),
    "[DONE]",
  ],
};

void test("the connection check passes a server that streams tool calls and reads tool results", async () => {
  const server = await fake((seen) => {
    if (seen.body.response_format) return chatAnswer(JSON.stringify(review));
    if (seen.body.stream) return toolCallStream;
    // The answer after the tool result.
    return chatAnswer("DEMO-1 is In review.");
  });
  const config = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
    LICTORY_AI_MODEL: "qwen-local",
  });
  const report = await checkAiProvider({
    text: { state: "configured", config },
    transcription: { state: "disabled" },
  });
  assert.deepEqual(
    report.text.checks.map((c) => [c.id, c.ok]),
    [
      ["structured-output", true],
      ["streamed-tool-call", true],
      ["tool-result", true],
    ],
    JSON.stringify(report.text.checks),
  );
  assert.equal(report.ok, true);
  // The replayed tool result reached the endpoint as a tool message.
  const last = server.seen.at(-1)!.body.messages as {
    role: string;
    tool_call_id?: string;
  }[];
  assert.ok(last.some((m) => m.role === "tool" && m.tool_call_id === "call_1"));
  // Only synthetic content was sent.
  assert.ok(
    server.seen.every((s) => JSON.stringify(s.body).includes("DEMO-1")),
  );
});

void test("the connection check reports a model without tool support and skips what depends on it", async () => {
  const server = await fake((seen) =>
    seen.body.tools
      ? {
          status: 400,
          json: {
            error:
              "registry.ollama.ai/library/gemma3:4b does not support tools",
          },
        }
      : chatAnswer(JSON.stringify(review)),
  );
  const config = configured({
    LICTORY_AI_PROVIDER: "openai-compatible",
    LICTORY_AI_BASE_URL: `${server.url}/v1`,
    LICTORY_AI_MODEL: "gemma3:4b",
  });
  const report = await checkAiProvider({
    text: { state: "configured", config },
    transcription: { state: "disabled" },
  });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.text.checks.map((c) => [c.id, c.ok]),
    [
      ["structured-output", true],
      ["streamed-tool-call", false],
    ],
  );
  assert.match(report.text.checks[1]!.detail, /does not support tool calls/);
  assert.match(report.text.checks[1]!.needs, /Litto/);
});

void test("a substituted model keeps working for tests and drills", () => {
  const substitute = analyzerTarget({
    model: languageModel(
      configured({
        LICTORY_AI_PROVIDER: "openai-compatible",
        LICTORY_AI_BASE_URL: "http://127.0.0.1:9/v1",
        LICTORY_AI_MODEL: "m",
      }),
    ),
    modelId: "drill",
  });
  assert.equal(substitute.modelId, "drill");
  assert.equal(substitute.config.structuredOutput, "json-schema");
});

void test("invalid base URLs are reported without echoing anything secret", () => {
  for (const value of [
    "https://user:hunter2-secret@host.example/v1?api-key=query-secret",
    "ftp://user:hunter2-secret@host.example/v1",
    "http://host.example/v1?api-key=query-secret",
    "http://host.example/v1#query-secret",
    "not a url query-secret",
  ]) {
    const source = {
      LICTORY_AI_PROVIDER: "openai-compatible",
      LICTORY_AI_MODEL: "m",
      LICTORY_AI_BASE_URL: value,
    };
    const text = problems(source);
    assert.doesNotMatch(text, /secret/, value);
    assert.doesNotMatch(
      JSON.stringify(describeAiProvider(source)),
      /secret/,
      value,
    );
  }
  assert.doesNotMatch(
    problems({
      OPENAI_API_KEY: "sk",
      OPENAI_BASE_URL: "https://u:legacy-secret@gateway.example/v1",
    }),
    /secret/,
  );
});

void test("a turn resumed on another provider keeps no metadata under the new provider's name", () => {
  const before = providerFingerprint({
    provider: "openai",
    baseURL: "https://gateway-a.internal/v1",
  });
  const after = providerFingerprint({
    provider: "openai",
    baseURL: "https://gateway-b.internal/v1",
  });
  // The turn paused for an approval on endpoint A.
  const waiting = {
    id: "a1",
    role: "assistant",
    metadata: { generatedBy: before },
    parts: [
      {
        type: "reasoning",
        text: "Need the item first.",
        providerMetadata: {
          openai: { itemId: "rs_a", reasoningEncryptedContent: "enc-a" },
        },
      },
      {
        type: "tool-getWorkItem",
        toolCallId: "call_a",
        state: "output-available",
        input: { key: "PAY-1" },
        output: { title: "Retry" },
        callProviderMetadata: { openai: { itemId: "fc_a" } },
      },
    ],
  } as unknown as ChatMessage;
  // Endpoint B continues it and stamps the message as its own.
  const continued = continuedBy(waiting, after);
  assert.equal(continued.metadata?.generatedBy, after);
  assert.ok(!JSON.stringify(continued).includes("enc-a"));
  assert.ok(!JSON.stringify(continued).includes("fc_a"));
  // The person still sees the earlier reasoning text.
  assert.equal(continued.parts[0]!.type, "reasoning");
  // On B's next step, nothing from A is sent: the reasoning without B's
  // metadata is left out, the tool call and result stay paired.
  const sent = replayableMessages([continued], after)[0]!;
  assert.deepEqual(
    sent.parts.map((p) => p.type),
    ["tool-getWorkItem"],
  );
  assert.ok(!JSON.stringify(sent).includes("enc-a"));
  // Endpoint A's own continuation is unchanged.
  assert.deepEqual(continuedBy(waiting, before).parts, waiting.parts);
});
