// The SDK adapters of the AI providers (settings and validation are in
// ai/provider-settings.ts, which this module re-exports). Only the selected
// provider's adapter is ever built, and every setting is passed explicitly so
// an SDK never falls back to its own environment variables.
//
// The SDKs are loaded on first use, never when this module loads: each SDK
// module builds a default client of its own as it is evaluated (`openai =
// createOpenAI()`), reading its variables straight from process.env, and
// @ai-sdk/openai refuses a blank OPENAI_BASE_URL, which compose forwards when
// the operator sets none. A server without AI therefore never evaluates an
// SDK, and before one is loaded blank variables are removed, so they are unset
// for the SDK as they are for Lictory (lib/env.ts).
import { createHash } from "node:crypto";
import { lookup as lookupAddress, type LookupAddress } from "node:dns";
import { Agent } from "undici";
import type { LanguageModel, TranscriptionModel } from "ai";
import {
  aiProvider,
  dictationConfig,
  isMetadataAddress,
  type AiProviderConfig,
  type EntraCredentials,
  type TranscriptionConfig,
} from "@lictory/core/ai/provider-settings";
import { env, unsetBlankVariables } from "@lictory/core/lib/env";

export * from "@lictory/core/ai/provider-settings";

export class EndpointRefused extends Error {}

function sdk<T>(load: () => Promise<T>): Promise<T> {
  unsetBlankVariables();
  return load();
}

/**
 * The fetch for endpoints entered in the admin console: the host must not
 * resolve to cloud instance metadata or link-local addresses (where the
 * machine's own credentials live), and redirects are not followed, so a
 * console setting cannot be turned into a request to them. Endpoints from
 * the environment are the operator's and use the plain fetch.
 */
const refused = () =>
  new EndpointRefused(
    "The configured endpoint resolves to a link-local or cloud metadata address, which Lictory does not call. Use the model server's own address.",
  );

// Every connection checks the addresses it is about to use, so a name that
// resolves differently at connect time (DNS rebinding) is caught too.
const guardedAgent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      lookupAddress(hostname, { ...options, all: true }, (error, found) => {
        if (error) return callback(error, "", 4);
        const addresses = found;
        if (addresses.some(({ address }) => isMetadataAddress(address)))
          return callback(refused(), "", 4);
        if ((options as { all?: boolean }).all)
          return (callback as unknown as (e: null, a: LookupAddress[]) => void)(
            null,
            addresses,
          );
        callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    },
  },
});

/**
 * The fetch for endpoints entered in the admin console: they must not reach
 * cloud instance metadata or link-local addresses (where the machine's own
 * credentials live), whether written as an address or behind a name, and
 * redirects are not followed. Endpoints from the environment are the
 * operator's and use the plain fetch.
 */
export const guardedFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  // An address in the URL is never looked up: judge it here.
  if (isMetadataAddress(new URL(href).hostname)) throw refused();
  try {
    // Node's own fetch, with the guarded connections (its bodies, such as
    // the SDK's FormData, stay native).
    return await fetch(input, {
      ...init,
      redirect: "error",
      dispatcher: guardedAgent,
    } as RequestInit);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof EndpointRefused) throw cause;
    throw error;
  }
}) as typeof fetch;

const fetchFor = (config: { source: string }) =>
  config.source === "console" ? guardedFetch : undefined;

// Microsoft Entra ID for Azure without a key: a service principal's client
// credentials, or the machine's managed identity (App Service and Container
// Apps through IDENTITY_ENDPOINT, virtual machines and AKS nodes through the
// instance metadata service). Tokens are cached until shortly before they
// expire. These calls go to Microsoft's fixed endpoints, never to one a
// person entered.
const COGNITIVE_SERVICES = "https://cognitiveservices.azure.com";
const tokens = new Map<string, { token: string; expires: number }>();

export class EntraError extends Error {}

export async function entraToken(
  entra: EntraCredentials,
  request: typeof fetch = fetch,
): Promise<string> {
  // A rotated secret is a different identity: its token is never reused.
  const id =
    entra.kind === "service-principal"
      ? `sp:${entra.tenantId}:${entra.clientId}:${createHash("sha256").update(entra.clientSecret).digest("hex").slice(0, 16)}`
      : `mi:${entra.clientId ?? ""}`;
  const cached = tokens.get(id);
  if (cached && cached.expires - 120_000 > Date.now()) return cached.token;
  let response: Response;
  try {
    if (entra.kind === "service-principal")
      response = await request(
        `https://login.microsoftonline.com/${encodeURIComponent(entra.tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: entra.clientId,
            client_secret: entra.clientSecret,
            scope: `${COGNITIVE_SERVICES}/.default`,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    else {
      const endpoint = env("IDENTITY_ENDPOINT");
      const header = env("IDENTITY_HEADER");
      const query = new URLSearchParams({
        resource: COGNITIVE_SERVICES,
        ...(entra.clientId ? { client_id: entra.clientId } : {}),
      });
      response =
        endpoint && header
          ? await request(`${endpoint}?api-version=2019-08-01&${query}`, {
              headers: { "X-IDENTITY-HEADER": header },
              signal: AbortSignal.timeout(15_000),
            })
          : await request(
              `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&${query}`,
              {
                headers: { Metadata: "true" },
                signal: AbortSignal.timeout(15_000),
              },
            );
    }
  } catch {
    throw new EntraError(
      entra.kind === "service-principal"
        ? "This server could not reach Microsoft Entra ID to sign in to Azure. Check its network access to login.microsoftonline.com."
        : "This server has no Azure managed identity to sign in with. Assign one to the machine, or configure a key or a service principal.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number | string;
    expires_on?: number | string;
  } | null;
  if (!response.ok || !body?.access_token)
    throw new EntraError(
      entra.kind === "service-principal"
        ? `Microsoft Entra ID refused the service principal (HTTP ${response.status}). Check the tenant ID, client ID and client secret.`
        : `The Azure managed identity could not get a token (HTTP ${response.status}). Check that it is assigned and has access to the Azure OpenAI resource.`,
    );
  const expires = body.expires_on
    ? Number(body.expires_on) * 1000
    : Date.now() + Number(body.expires_in ?? 3000) * 1000;
  tokens.set(id, { token: body.access_token, expires });
  return body.access_token;
}

const azure = async (
  config: { apiKey?: string; baseURL: string; entra?: EntraCredentials },
  fetch: typeof globalThis.fetch | undefined,
) => {
  const { createAzure } = await sdk(() => import("@ai-sdk/azure"));
  return createAzure({
    baseURL: config.baseURL,
    fetch,
    ...(config.apiKey
      ? { apiKey: config.apiKey }
      : {
          tokenProvider: () =>
            entraToken(config.entra ?? { kind: "managed-identity" }),
        }),
  });
};

// Vertex AI: an express-mode API key, a service account key, or the
// server's own Google Cloud identity. A base URL is set only by tests (the
// catalog offers none).
const vertex = async (
  config: {
    apiKey?: string;
    project?: string;
    location?: string;
    googleCredentials?: Record<string, string>;
    baseURL: string;
    customBaseUrl: boolean;
  },
  fetch: typeof globalThis.fetch | undefined,
) => {
  const { createVertex } = await sdk(() => import("@ai-sdk/google-vertex"));
  return createVertex({
    fetch,
    ...(config.customBaseUrl ? { baseURL: config.baseURL } : {}),
    ...(config.apiKey
      ? { apiKey: config.apiKey }
      : {
          // An empty key, so the SDK never falls back to GOOGLE_VERTEX_API_KEY
          // and switches to express mode behind the configuration's back.
          apiKey: "",
          project: config.project,
          location: config.location,
          googleAuthOptions: config.googleCredentials
            ? { credentials: config.googleCredentials }
            : {},
        }),
  });
};

// The server's own AWS identity (instance profile, task role, web identity
// or the AWS_* variables), when no key is configured.
const awsIdentity = async () => {
  const { defaultProvider } = await sdk(
    () => import("@aws-sdk/credential-provider-node"),
  );
  const provider = defaultProvider();
  return async () => {
    const { accessKeyId, secretAccessKey, sessionToken } = await provider();
    return { accessKeyId, secretAccessKey, sessionToken };
  };
};

/** The SDK model for this configuration; only ever the selected provider. */
export async function languageModel(
  config: AiProviderConfig,
): Promise<LanguageModel> {
  const { apiKey, baseURL, model } = config;
  const fetch = fetchFor(config);
  switch (config.adapter) {
    case "openai": {
      const { createOpenAI } = await sdk(() => import("@ai-sdk/openai"));
      return createOpenAI({ apiKey, baseURL, fetch })(model);
    }
    case "anthropic": {
      const { createAnthropic } = await sdk(() => import("@ai-sdk/anthropic"));
      return createAnthropic({ apiKey, baseURL, fetch })(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await sdk(
        () => import("@ai-sdk/google"),
      );
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(model);
    }
    case "vertex":
      return (await vertex(config, fetch))(model);
    case "azure":
      return (await azure(config, fetch))(model);
    case "bedrock": {
      const { createAmazonBedrock } = await sdk(
        () => import("@ai-sdk/amazon-bedrock"),
      );
      return createAmazonBedrock({
        region: config.region,
        ...(config.customBaseUrl ? { baseURL } : {}),
        fetch,
        ...(config.apiKey
          ? { apiKey }
          : config.accessKeyId
            ? {
                // Never AWS_BEARER_TOKEN_BEDROCK from the environment.
                apiKey: "",
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : { apiKey: "", credentialProvider: await awsIdentity() }),
      })(model);
    }
    case "mistral": {
      const { createMistral } = await sdk(() => import("@ai-sdk/mistral"));
      return createMistral({ apiKey, baseURL, fetch })(model);
    }
    case "xai": {
      const { createXai } = await sdk(() => import("@ai-sdk/xai"));
      return createXai({ apiKey, baseURL, fetch })(model);
    }
    case "groq": {
      const { createGroq } = await sdk(() => import("@ai-sdk/groq"));
      return createGroq({ apiKey, baseURL, fetch })(model);
    }
    case "deepseek": {
      const { createDeepSeek } = await sdk(() => import("@ai-sdk/deepseek"));
      return createDeepSeek({ apiKey, baseURL, fetch })(model);
    }
    case "openai-compatible": {
      const { createOpenAICompatible } = await sdk(
        () => import("@ai-sdk/openai-compatible"),
      );
      return createOpenAICompatible({
        name: "openaiCompatible",
        baseURL,
        // Keyless local servers get no Authorization header at all.
        ...(apiKey ? { apiKey } : {}),
        fetch,
        includeUsage: true,
        supportsStructuredOutputs: config.structuredOutput === "json-schema",
      }).chatModel(model);
    }
  }
}

/** The configured model, or an error when none is configured. */
export async function configuredModel() {
  const config = aiProvider();
  if (!config)
    throw new Error("Lictory Intelligence has no configured AI provider.");
  return { config, model: await languageModel(config) };
}

/**
 * The SDK transcription model for dictation of recorded segments. Realtime
 * dictation (OpenAI Realtime) has no server-side model: the browser streams
 * to the provider with a short-lived token (intelligence/voice).
 */
export async function transcriptionModel(
  config: TranscriptionConfig,
): Promise<TranscriptionModel> {
  const { apiKey, baseURL, model } = config;
  const fetch = fetchFor(config);
  switch (config.adapter) {
    case "openai":
    case "openai-compatible": {
      // Self-hosted Whisper servers speak OpenAI's /audio/transcriptions.
      const { createOpenAI } = await sdk(() => import("@ai-sdk/openai"));
      return createOpenAI({
        apiKey: apiKey ?? "not-needed",
        baseURL,
        fetch,
      }).transcription(model);
    }
    case "azure":
      return (await azure(config, fetch)).transcription(model);
    case "vertex":
      return (await vertex(config, fetch)).transcription(model);
    case "groq": {
      const { createGroq } = await sdk(() => import("@ai-sdk/groq"));
      return createGroq({ apiKey, baseURL, fetch }).transcription(model);
    }
    case "deepgram": {
      const { createDeepgram } = await sdk(() => import("@ai-sdk/deepgram"));
      return createDeepgram({ apiKey, fetch }).transcription(model);
    }
    case "elevenlabs": {
      const { createElevenLabs } = await sdk(
        () => import("@ai-sdk/elevenlabs"),
      );
      return createElevenLabs({ apiKey, fetch }).transcription(model);
    }
    case "assemblyai": {
      const { createAssemblyAI } = await sdk(
        () => import("@ai-sdk/assemblyai"),
      );
      return createAssemblyAI({ apiKey, fetch }).transcription(model);
    }
    case "mistral": {
      const { createMistral } = await sdk(() => import("@ai-sdk/mistral"));
      return createMistral({ apiKey, baseURL, fetch }).transcription(model);
    }
    case "openai-realtime":
      throw new Error("Realtime dictation has no server-side model.");
  }
}

/** Provider options for a transcription request. */
export function transcriptionOptions(
  config: TranscriptionConfig,
): Record<string, Record<string, string>> {
  // Self-hosted servers reliably support plain JSON; OpenAI's verbose_json
  // default is not universal.
  return config.adapter === "openai-compatible"
    ? { openai: { responseFormat: "json" } }
    : {};
}

export async function configuredTranscription() {
  const config = dictationConfig();
  if (config?.mode !== "segments")
    throw new Error("Dictation of recorded segments is not configured.");
  return { config, model: await transcriptionModel(config) };
}
