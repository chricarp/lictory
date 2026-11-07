// The AI providers a server can be configured with, as one catalog shared by
// the server (validation, adapters), the admin console (the settings form) and
// the `lictory ai` command. Names, fields and hints only: no endpoint a person
// chose and no credential is ever part of it. Safe for browsers.
//
// Adding a provider: an entry here, its SDK adapter in ai/provider.ts, and a
// contract test against a fake of its protocol (ai/provider.test.ts).

/** A setting of a provider, as the console form and the environment name it. */
export type AiField =
  | "apiKey"
  | "baseUrl"
  | "model"
  | "region"
  | "project"
  | "location"
  | "accessKeyId"
  | "secretAccessKey"
  | "structuredOutput";
export type AiFieldNeed = "required" | "optional";

/** Where a provider runs: the vendor's cloud, or the company's own machines. */
export type AiHosting = "cloud" | "self-hosted";

/** Which SDK adapter serves a text provider (ai/provider.ts). */
export type TextAdapter =
  | "openai"
  | "anthropic"
  | "google"
  | "vertex"
  | "azure"
  | "bedrock"
  | "mistral"
  | "xai"
  | "groq"
  | "deepseek"
  | "openai-compatible";

export type TextProvider = {
  label: string;
  hosting: AiHosting;
  adapter: TextAdapter;
  /** Who is paid and holds the content; transcription reuses a key per vendor. */
  vendor: string;
  protocol: string;
  fields: Partial<Record<AiField, AiFieldNeed>>;
  defaultBaseUrl?: string;
  /** Azure's endpoints are always https; a plain-http URL is a mistake. */
  httpsOnly?: boolean;
  defaultModel?: string;
  /** Suggestions for the model field; any id the endpoint serves works. */
  models: readonly string[];
  modelHint: string;
  /**
   * How reviews, intake and titles get schema-conforming JSON: the
   * provider's own structured output, JSON mode with the schema in the
   * instructions, or the operator's choice.
   */
  structuredOutput: "native" | "json-object" | "configurable";
  /** OpenAI and Azure Responses are sent `store: false`. */
  noStorageRequest: boolean;
  /** Where the operator gets a key. */
  keysUrl?: string;
  /** One sentence for the form, shown under the provider. */
  note?: string;
};

export type TranscriptionMode =
  /** The browser streams audio straight to the provider (OpenAI Realtime). */
  | "realtime"
  /** The browser records short clips; the server sends each to the provider. */
  | "segments";

export type TranscriptionAdapter =
  | "openai-realtime"
  | "openai"
  | "azure"
  | "vertex"
  | "groq"
  | "deepgram"
  | "elevenlabs"
  | "assemblyai"
  | "mistral"
  | "openai-compatible";

export type TranscriptionProvider = {
  label: string;
  hosting: AiHosting;
  adapter: TranscriptionAdapter;
  vendor: string;
  mode: TranscriptionMode;
  fields: Partial<Record<AiField, AiFieldNeed>>;
  defaultBaseUrl?: string;
  httpsOnly?: boolean;
  defaultModel?: string;
  models: readonly string[];
  modelHint: string;
  keysUrl?: string;
  note?: string;
};

const SAME_MACHINE = "host.docker.internal";

export const textProviders = {
  openai: {
    label: "OpenAI",
    hosting: "cloud",
    adapter: "openai",
    vendor: "openai",
    protocol: "OpenAI Responses API",
    fields: { apiKey: "required", model: "optional", baseUrl: "optional" },
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-6-luna",
    models: ["gpt-6-luna"],
    modelHint: "A model id from your OpenAI project.",
    structuredOutput: "native",
    noStorageRequest: true,
    keysUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    hosting: "cloud",
    adapter: "anthropic",
    vendor: "anthropic",
    protocol: "Anthropic Messages API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    modelHint:
      "A Claude model id. For Claude in Azure AI Foundry, the deployment name.",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://console.anthropic.com/settings/keys",
    note: "For Claude in Azure AI Foundry, set the base URL to https://<resource>.services.ai.azure.com/anthropic/v1 and use the Foundry key.",
  },
  google: {
    label: "Google Gemini",
    hosting: "cloud",
    adapter: "google",
    vendor: "google",
    protocol: "Gemini API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-pro-preview"],
    modelHint: "A Gemini model id from Google AI Studio.",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://aistudio.google.com/apikey",
  },
  vertex: {
    label: "Google Vertex AI",
    hosting: "cloud",
    adapter: "vertex",
    vendor: "google-cloud",
    protocol: "Vertex AI Gemini API",
    fields: {
      model: "required",
      project: "optional",
      location: "optional",
      apiKey: "optional",
    },
    models: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3-pro-preview"],
    modelHint: "A Gemini model id available in your project and location.",
    structuredOutput: "native",
    noStorageRequest: false,
    note: "Authenticate with a service account key (paste its JSON as the key), an express-mode API key, or the server's own Google Cloud identity (leave the key empty). Project and location are required unless you use an API key.",
  },
  azure: {
    label: "Azure OpenAI",
    hosting: "cloud",
    adapter: "azure",
    vendor: "azure",
    protocol: "Azure OpenAI Responses API (v1)",
    fields: { apiKey: "required", baseUrl: "required", model: "required" },
    httpsOnly: true,
    models: [],
    modelHint: "The name of your model deployment.",
    structuredOutput: "native",
    noStorageRequest: true,
    note: "Base URL: https://<resource>.openai.azure.com/openai/v1. Also serves Foundry models your resource offers through the Responses API.",
  },
  bedrock: {
    label: "Amazon Bedrock",
    hosting: "cloud",
    adapter: "bedrock",
    vendor: "aws",
    protocol: "Bedrock Converse API",
    fields: {
      region: "required",
      model: "required",
      apiKey: "optional",
      accessKeyId: "optional",
      secretAccessKey: "optional",
    },
    models: ["anthropic.claude-sonnet-5-5", "anthropic.claude-opus-5-5"],
    modelHint:
      "A model id or inference profile id enabled in your account and region.",
    structuredOutput: "native",
    noStorageRequest: false,
    note: "Authenticate with a Bedrock API key, an access key pair, or the server's own AWS identity (an instance or task role: leave both empty).",
  },
  mistral: {
    label: "Mistral AI",
    hosting: "cloud",
    adapter: "mistral",
    vendor: "mistral",
    protocol: "Mistral API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-medium-latest"],
    modelHint: "A Mistral model id.",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://console.mistral.ai/api-keys",
  },
  xai: {
    label: "xAI",
    hosting: "cloud",
    adapter: "xai",
    vendor: "xai",
    protocol: "xAI API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://api.x.ai/v1",
    models: ["grok-latest", "grok-4.7"],
    modelHint: "A Grok model id.",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://console.x.ai",
  },
  groq: {
    label: "Groq",
    hosting: "cloud",
    adapter: "groq",
    vendor: "groq",
    protocol: "Groq API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    modelHint: "A model id Groq serves (open-weight models).",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://console.groq.com/keys",
  },
  deepseek: {
    label: "DeepSeek",
    hosting: "cloud",
    adapter: "deepseek",
    vendor: "deepseek",
    protocol: "DeepSeek API",
    fields: { apiKey: "required", model: "required", baseUrl: "optional" },
    defaultBaseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    modelHint: "A DeepSeek model id.",
    // DeepSeek offers JSON mode, not JSON schemas.
    structuredOutput: "json-object",
    noStorageRequest: false,
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  openrouter: {
    label: "OpenRouter",
    hosting: "cloud",
    adapter: "openai-compatible",
    vendor: "openrouter",
    protocol: "OpenRouter (OpenAI Chat Completions)",
    fields: { apiKey: "required", model: "required" },
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-sonnet-5-5", "openai/gpt-oss-120b"],
    modelHint: "A model id as OpenRouter lists it (vendor/model).",
    structuredOutput: "native",
    noStorageRequest: false,
    keysUrl: "https://openrouter.ai/keys",
    note: "OpenRouter forwards each request to the model's provider; its routing settings decide which one.",
  },
  ollama: {
    label: "Ollama",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    protocol: "OpenAI Chat Completions",
    fields: {
      baseUrl: "optional",
      model: "required",
      structuredOutput: "optional",
    },
    defaultBaseUrl: `http://${SAME_MACHINE}:11434/v1`,
    models: ["qwen3:32b", "gpt-oss:20b", "llama3.3:70b"],
    modelHint:
      "A model you pulled (ollama list). It must support tools for Litto.",
    structuredOutput: "configurable",
    noStorageRequest: false,
    note: "Run Ollama with OLLAMA_HOST=0.0.0.0:11434, a larger OLLAMA_CONTEXT_LENGTH (32768 or more) and OLLAMA_NO_CLOUD=1.",
  },
  vllm: {
    label: "vLLM",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    protocol: "OpenAI Chat Completions",
    fields: {
      baseUrl: "optional",
      model: "required",
      apiKey: "optional",
      structuredOutput: "optional",
    },
    defaultBaseUrl: `http://${SAME_MACHINE}:8000/v1`,
    models: [],
    modelHint: "The model vLLM serves (vllm serve <model>).",
    structuredOutput: "configurable",
    noStorageRequest: false,
    note: "Start vLLM with --enable-auto-tool-choice and the --tool-call-parser for your model so Litto can call tools.",
  },
  lmstudio: {
    label: "LM Studio",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    protocol: "OpenAI Chat Completions",
    fields: {
      baseUrl: "optional",
      model: "required",
      structuredOutput: "optional",
    },
    defaultBaseUrl: `http://${SAME_MACHINE}:1234/v1`,
    models: [],
    modelHint: "The model identifier LM Studio shows for the loaded model.",
    structuredOutput: "configurable",
    noStorageRequest: false,
    note: "Turn on “Serve on local network” in LM Studio's server settings.",
  },
  llamacpp: {
    label: "llama.cpp server",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    protocol: "OpenAI Chat Completions",
    fields: {
      baseUrl: "optional",
      model: "required",
      apiKey: "optional",
      structuredOutput: "optional",
    },
    defaultBaseUrl: `http://${SAME_MACHINE}:8080/v1`,
    models: [],
    modelHint: "Any name; llama-server serves the model it loaded.",
    structuredOutput: "configurable",
    noStorageRequest: false,
    note: "Start llama-server with --jinja (tool calls) and --host 0.0.0.0.",
  },
  "openai-compatible": {
    label: "Other OpenAI-compatible endpoint",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    protocol: "OpenAI Chat Completions",
    fields: {
      baseUrl: "required",
      model: "required",
      apiKey: "optional",
      structuredOutput: "optional",
    },
    models: [],
    modelHint: "The model id the endpoint serves.",
    structuredOutput: "configurable",
    noStorageRequest: false,
    note: "LocalAI, SGLang, TGI, LiteLLM and other gateways with /v1/chat/completions.",
  },
} as const satisfies Record<string, TextProvider>;

export type TextProviderId = keyof typeof textProviders;
export const textProviderIds = Object.keys(textProviders) as TextProviderId[];

export const transcriptionProviders = {
  "openai-realtime": {
    label: "OpenAI Realtime (live)",
    hosting: "cloud",
    adapter: "openai-realtime",
    vendor: "openai",
    mode: "realtime",
    fields: { apiKey: "required", model: "optional" },
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-live-transcribe",
    models: ["gpt-live-transcribe"],
    modelHint: "A realtime transcription model.",
    keysUrl: "https://platform.openai.com/api-keys",
    note: "Words appear while people speak. Audio goes from the browser straight to OpenAI, never through this server.",
  },
  openai: {
    label: "OpenAI",
    hosting: "cloud",
    adapter: "openai",
    vendor: "openai",
    mode: "segments",
    fields: { apiKey: "required", model: "optional", baseUrl: "optional" },
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini-transcribe",
    models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
    modelHint: "An OpenAI transcription model.",
    keysUrl: "https://platform.openai.com/api-keys",
  },
  azure: {
    label: "Azure OpenAI",
    hosting: "cloud",
    adapter: "azure",
    vendor: "azure",
    mode: "segments",
    fields: { apiKey: "required", baseUrl: "required", model: "required" },
    httpsOnly: true,
    models: [],
    modelHint:
      "The name of your transcription deployment (Whisper or gpt-4o-transcribe).",
  },
  vertex: {
    label: "Google Cloud Speech (Vertex AI)",
    hosting: "cloud",
    adapter: "vertex",
    vendor: "google-cloud",
    mode: "segments",
    fields: {
      model: "optional",
      project: "optional",
      location: "optional",
      apiKey: "optional",
    },
    defaultModel: "chirp_3",
    models: ["chirp_3", "chirp_2"],
    modelHint: "A Speech-to-Text model.",
    note: "Authenticates like Vertex AI for text: a service account key, an API key, or the server's own identity.",
  },
  groq: {
    label: "Groq (Whisper)",
    hosting: "cloud",
    adapter: "groq",
    vendor: "groq",
    mode: "segments",
    fields: { apiKey: "required", model: "optional" },
    defaultModel: "whisper-large-v3-turbo",
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
    modelHint: "A Whisper model Groq serves.",
    keysUrl: "https://console.groq.com/keys",
  },
  deepgram: {
    label: "Deepgram",
    hosting: "cloud",
    adapter: "deepgram",
    vendor: "deepgram",
    mode: "segments",
    fields: { apiKey: "required", model: "optional" },
    defaultModel: "nova-3",
    models: ["nova-3", "nova-3-general"],
    modelHint: "A Deepgram model.",
    keysUrl: "https://console.deepgram.com",
  },
  elevenlabs: {
    label: "ElevenLabs",
    hosting: "cloud",
    adapter: "elevenlabs",
    vendor: "elevenlabs",
    mode: "segments",
    fields: { apiKey: "required", model: "optional" },
    defaultModel: "scribe_v2",
    models: ["scribe_v2", "scribe_v1"],
    modelHint: "A Scribe model.",
    keysUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  assemblyai: {
    label: "AssemblyAI",
    hosting: "cloud",
    adapter: "assemblyai",
    vendor: "assemblyai",
    mode: "segments",
    fields: { apiKey: "required", model: "optional" },
    defaultModel: "universal-2",
    models: ["universal-2", "universal-3-pro"],
    modelHint: "An AssemblyAI speech model.",
    keysUrl: "https://www.assemblyai.com/app/api-keys",
  },
  mistral: {
    label: "Mistral AI (Voxtral)",
    hosting: "cloud",
    adapter: "mistral",
    vendor: "mistral",
    mode: "segments",
    fields: { apiKey: "required", model: "optional" },
    defaultModel: "voxtral-mini-latest",
    models: ["voxtral-mini-latest"],
    modelHint: "A Voxtral model.",
    keysUrl: "https://console.mistral.ai/api-keys",
  },
  speaches: {
    label: "Speaches (faster-whisper)",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    mode: "segments",
    fields: { baseUrl: "optional", model: "required", apiKey: "optional" },
    defaultBaseUrl: `http://${SAME_MACHINE}:8000/v1`,
    models: [
      "Systran/faster-whisper-large-v3",
      "Systran/faster-distil-whisper-large-v3",
    ],
    modelHint: "A Whisper model the server has downloaded.",
    note: "Open-weight Whisper models on your own hardware.",
  },
  "whisper-cpp": {
    label: "whisper.cpp server",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    mode: "segments",
    fields: { baseUrl: "optional", model: "optional" },
    defaultBaseUrl: `http://${SAME_MACHINE}:8080/v1`,
    defaultModel: "whisper-1",
    models: ["whisper-1"],
    modelHint: "Ignored by whisper.cpp; it uses the model it loaded.",
    note: "Start whisper-server with --host 0.0.0.0 --inference-path /v1/audio/transcriptions.",
  },
  "openai-compatible": {
    label: "Other OpenAI-compatible endpoint",
    hosting: "self-hosted",
    adapter: "openai-compatible",
    vendor: "self-hosted",
    mode: "segments",
    fields: { baseUrl: "required", model: "required", apiKey: "optional" },
    models: [],
    modelHint: "The model id the endpoint serves.",
    note: "vLLM, LocalAI and other servers with /v1/audio/transcriptions.",
  },
} as const satisfies Record<string, TranscriptionProvider>;

export type TranscriptionProviderId = keyof typeof transcriptionProviders;
export const transcriptionProviderIds = Object.keys(
  transcriptionProviders,
) as TranscriptionProviderId[];

/** The provider ids a directory may name (text providers). */
export const aiProviderKinds = textProviderIds as unknown as readonly [
  TextProviderId,
  ...TextProviderId[],
];
export type AiProviderKind = TextProviderId;

export const aiProviderLabels = Object.fromEntries(
  textProviderIds.map((id) => [id, textProviders[id].label]),
) as Record<TextProviderId, string>;

/** Field labels for the console and for messages about console settings. */
export const aiFieldLabels: Record<AiField, string> = {
  apiKey: "API key",
  baseUrl: "Base URL",
  model: "Model",
  region: "Region",
  project: "Project",
  location: "Location",
  accessKeyId: "Access key ID",
  secretAccessKey: "Secret access key",
  structuredOutput: "Structured output",
};

/** Fields whose values are secrets: write-only in the console. */
export const secretFields: readonly AiField[] = [
  "apiKey",
  "accessKeyId",
  "secretAccessKey",
];

export const textProviderOf = (id: string): TextProvider | undefined =>
  (textProviders as Record<string, TextProvider>)[id];
export const transcriptionProviderOf = (
  id: string,
): TranscriptionProvider | undefined =>
  (transcriptionProviders as Record<string, TranscriptionProvider>)[id];
