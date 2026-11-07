// Which model service Lictory Intelligence talks to, chosen by the operator in
// the server's environment and never from the browser: an endpoint is part of
// the installation, like its database. Organizations only decide whether
// their content may be sent there (`setAiPolicy`).
//
// One provider serves every text feature (reviews, proposal intake, Litto,
// titles). There is no fallback: when the selected provider is incomplete the
// server does not start, and when it fails the request fails with a message
// naming the setting to check. Nothing is ever retried on another provider.
//
// This module is the pure part (settings, validation, capabilities) and loads
// no SDK; ai/provider.ts adds the SDK adapters.
//
// Adding a provider: a kind in contracts/ai-provider.ts, its capabilities and
// settings here, its SDK adapter in ai/provider.ts `languageModel`, and a
// contract test with a fake of its protocol (provider.test.ts).
import { createHash } from "node:crypto";
import { z } from "zod";
import { env, type Environment } from "@lictory/core/lib/env";
import {
  aiProviderKinds,
  aiProviderLabels,
  type AiProviderKind,
} from "@lictory/core/contracts/ai-provider";

export { aiProviderKinds, type AiProviderKind };

export const structuredOutputModes = ["json-schema", "json-object"] as const;
export type StructuredOutputMode = (typeof structuredOutputModes)[number];

export const DEFAULT_AI_MODEL = "gpt-6-luna";
export const DEFAULT_AI_TIMEOUT_SECONDS = 240;
// The review runner adds a minute for its own work and must stay below its
// ten-minute lease (ai/runner.ts).
export const AI_TIMEOUT_SECONDS_RANGE = { minimum: 30, maximum: 480 } as const;

const OPENAI_URL = "https://api.openai.com/v1";
const ANTHROPIC_URL = "https://api.anthropic.com/v1";

/**
 * What each protocol can do, as Lictory uses it. Whether a particular model
 * behind an endpoint supports tool calls or JSON schemas is not knowable from
 * the protocol: `lictory admin ai-check` and the admin console's check test it.
 */
export const providerCapabilities: Record<
  AiProviderKind,
  {
    label: string;
    protocol: string;
    /** How reviews, intake and titles get JSON that matches a schema. */
    structuredOutput: string;
    /** Litto's streaming tool calls. */
    tools: string;
    /** Whether the provider is asked not to store requests. */
    noStorageRequest: boolean;
    /** Live dictation (OpenAI Realtime only). */
    dictation: boolean;
  }
> = {
  openai: {
    label: aiProviderLabels.openai,
    protocol: "OpenAI Responses API",
    structuredOutput: "Native JSON schema",
    tools: "Supported",
    noStorageRequest: true,
    dictation: true,
  },
  anthropic: {
    label: aiProviderLabels.anthropic,
    protocol: "Anthropic Messages API",
    structuredOutput: "Native output format, or a JSON tool on older models",
    tools: "Supported",
    noStorageRequest: false,
    dictation: false,
  },
  azure: {
    label: aiProviderLabels.azure,
    protocol: "Azure OpenAI Responses API (v1)",
    structuredOutput: "Native JSON schema",
    tools: "Supported",
    noStorageRequest: true,
    dictation: false,
  },
  "openai-compatible": {
    label: aiProviderLabels["openai-compatible"],
    protocol: "OpenAI Chat Completions",
    structuredOutput:
      "`response_format` json_schema (json-schema) or json_object with the schema in the instructions (json-object)",
    tools: "Depends on the server and model",
    noStorageRequest: false,
    dictation: false,
  },
};

export type AiProviderConfig = {
  provider: AiProviderKind;
  model: string;
  /** Always explicit, so SDKs never read their own environment defaults. */
  baseURL: string;
  /** Never logged, never sent to browsers. */
  apiKey?: string;
  /** The variable the key came from, for messages that name what to check. */
  keySetting?: string;
  structuredOutput: StructuredOutputMode;
  timeoutMs: number;
};

export type AiResolution =
  /** No provider selected: Lictory Intelligence is unavailable, not broken. */
  | { state: "disabled" }
  | { state: "configured"; config: AiProviderConfig }
  /** An explicit selection that cannot work. The API and worker do not start. */
  | { state: "invalid"; problems: string[] };

// Settings only the explicit (non-legacy) configuration uses. Setting one
// without LICTORY_AI_PROVIDER is a problem rather than a guess.
const explicitSettings = [
  "LICTORY_AI_BASE_URL",
  "LICTORY_AI_API_KEY",
  "LICTORY_AI_STRUCTURED_OUTPUT",
] as const;

function baseUrlProblem(name: string, value: string, https: boolean) {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // Reported below.
  }
  if (
    !url ||
    !(https ? ["https:"] : ["http:", "https:"]).includes(url.protocol) ||
    url.search ||
    url.hash
  )
    return `${name} must be an ${https ? "https" : "http(s)"} URL without query or fragment, such as ${https ? "https://<resource>.openai.azure.com/openai/v1" : "http://inference.internal:11434/v1"}, got "${value}".`;
  if (url.username || url.password)
    return `${name} must not contain credentials. Put the key in LICTORY_AI_API_KEY.`;
  return undefined;
}
const trimSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * The provider this server uses, from its environment. Pure, so every API and
 * worker replica with the same environment resolves the same destination.
 */
export function resolveAiProvider(
  source: Environment = process.env,
): AiResolution {
  const problems: string[] = [];
  const selected = env("LICTORY_AI_PROVIDER", source);
  const timeoutSeconds = env("LICTORY_AI_TIMEOUT_SECONDS", source);
  let timeoutMs = DEFAULT_AI_TIMEOUT_SECONDS * 1000;
  if (timeoutSeconds !== undefined) {
    const { minimum, maximum } = AI_TIMEOUT_SECONDS_RANGE;
    const n = Number(timeoutSeconds);
    if (!/^\d+$/.test(timeoutSeconds) || n < minimum || n > maximum)
      problems.push(
        `LICTORY_AI_TIMEOUT_SECONDS must be a whole number from ${minimum} to ${maximum}, got "${timeoutSeconds}".`,
      );
    else timeoutMs = n * 1000;
  }
  const model = env("LICTORY_AI_MODEL", source);

  // Existing installations: OPENAI_API_KEY (and the SDK's OPENAI_BASE_URL).
  if (selected === undefined) {
    const stray = explicitSettings.filter((name) => env(name, source));
    if (stray.length)
      problems.push(
        `${stray.join(" and ")} ${stray.length === 1 ? "is" : "are"} set but LICTORY_AI_PROVIDER is not. Choose the provider explicitly: openai, anthropic, azure or openai-compatible.`,
      );
    if (problems.length) return { state: "invalid", problems };
    const apiKey = env("OPENAI_API_KEY", source);
    if (!apiKey) return { state: "disabled" };
    const legacyUrl = env("OPENAI_BASE_URL", source);
    const urlProblem =
      legacyUrl && baseUrlProblem("OPENAI_BASE_URL", legacyUrl, false);
    if (urlProblem) return { state: "invalid", problems: [urlProblem] };
    return {
      state: "configured",
      config: {
        provider: "openai",
        model: model ?? DEFAULT_AI_MODEL,
        baseURL: trimSlash(legacyUrl ?? OPENAI_URL),
        apiKey,
        keySetting: "OPENAI_API_KEY",
        structuredOutput: "json-schema",
        timeoutMs,
      },
    };
  }

  if (!(aiProviderKinds as readonly string[]).includes(selected))
    return {
      state: "invalid",
      problems: [
        `LICTORY_AI_PROVIDER must be one of ${aiProviderKinds.join(", ")}, got "${selected}".`,
        ...problems,
      ],
    };
  const provider = selected as AiProviderKind;
  const baseUrl = env("LICTORY_AI_BASE_URL", source);
  const key = env("LICTORY_AI_API_KEY", source);
  const mode = env("LICTORY_AI_STRUCTURED_OUTPUT", source);

  // The OpenAI key keeps working when the provider is named explicitly; no
  // other provider ever reads it.
  const apiKey =
    key ?? (provider === "openai" ? env("OPENAI_API_KEY", source) : undefined);
  const keySetting = key
    ? "LICTORY_AI_API_KEY"
    : apiKey
      ? "OPENAI_API_KEY"
      : undefined;
  const label = providerCapabilities[provider].label;
  if (!apiKey && provider !== "openai-compatible")
    problems.push(
      `LICTORY_AI_API_KEY is required with LICTORY_AI_PROVIDER=${provider} (the ${label} key).`,
    );
  if (!model && provider !== "openai")
    problems.push(
      provider === "azure"
        ? "LICTORY_AI_MODEL is required with LICTORY_AI_PROVIDER=azure: the name of your model deployment."
        : `LICTORY_AI_MODEL is required with LICTORY_AI_PROVIDER=${provider}: the model id the endpoint serves.`,
    );
  if (!baseUrl && (provider === "azure" || provider === "openai-compatible"))
    problems.push(
      provider === "azure"
        ? "LICTORY_AI_BASE_URL is required with LICTORY_AI_PROVIDER=azure, such as https://<resource>.openai.azure.com/openai/v1."
        : "LICTORY_AI_BASE_URL is required with LICTORY_AI_PROVIDER=openai-compatible: the endpoint's OpenAI-compatible base URL, such as http://host.docker.internal:11434/v1.",
    );
  const legacyUrl =
    provider === "openai" && !baseUrl
      ? env("OPENAI_BASE_URL", source)
      : undefined;
  const urlProblem = baseUrl
    ? baseUrlProblem("LICTORY_AI_BASE_URL", baseUrl, provider === "azure")
    : legacyUrl && baseUrlProblem("OPENAI_BASE_URL", legacyUrl, false);
  if (urlProblem) problems.push(urlProblem);
  if (mode !== undefined) {
    if (provider !== "openai-compatible")
      problems.push(
        `LICTORY_AI_STRUCTURED_OUTPUT applies only to LICTORY_AI_PROVIDER=openai-compatible; ${label} always uses its native structured output. Remove it.`,
      );
    else if (!(structuredOutputModes as readonly string[]).includes(mode))
      problems.push(
        `LICTORY_AI_STRUCTURED_OUTPUT must be one of ${structuredOutputModes.join(", ")}, got "${mode}".`,
      );
  }
  if (problems.length) return { state: "invalid", problems };
  return {
    state: "configured",
    config: {
      provider,
      model: model ?? DEFAULT_AI_MODEL,
      baseURL: trimSlash(
        baseUrl ??
          legacyUrl ??
          (provider === "anthropic" ? ANTHROPIC_URL : OPENAI_URL),
      ),
      apiKey,
      keySetting,
      structuredOutput: (mode as StructuredOutputMode) ?? "json-schema",
      timeoutMs,
    },
  };
}

/** The configured provider, or undefined when none is selected or valid. */
export function aiProvider(source: Environment = process.env) {
  const resolved = resolveAiProvider(source);
  return resolved.state === "configured" ? resolved.config : undefined;
}

export function aiConfigured(source: Environment = process.env) {
  return aiProvider(source) !== undefined;
}

// Host names that only make sense from the machine itself.
const loopbackNames = new Set(["localhost", "0.0.0.0", "::1", "[::1]"]);

function ipv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p)))
    return undefined;
  const n = parts.map(Number);
  return n.every((p) => p <= 255) ? n : undefined;
}

export function isLoopbackUrl(url: string) {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return loopbackNames.has(host) || ipv4(host)?.[0] === 127;
}

// Private networks, the container host alias, single-label names (Compose
// services, intranet hosts) and internal DNS suffixes.
function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (loopbackNames.has(host) || loopbackNames.has(`[${host}]`)) return true;
  const ip = ipv4(host);
  if (ip) {
    const [a, b] = ip as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (host.includes(":")) return /^(?:f[cd]|fe80)/.test(host);
  return (
    !host.includes(".") ||
    host === "host.docker.internal" ||
    /\.(?:internal|local|lan|home\.arpa|svc|cluster\.local)$/.test(host)
  );
}

/**
 * Startup rule for the API and the worker (config/validate.ts): an explicit
 * but incomplete selection stops them; risky but working settings warn.
 */
export function aiProviderRule(source: Environment) {
  const resolved = resolveAiProvider(source);
  if (resolved.state === "invalid")
    return `Lictory Intelligence is misconfigured: ${resolved.problems.join(" ")} See docs/operations/ai-providers.md.`;
  if (resolved.state !== "configured") return undefined;
  const { baseURL } = resolved.config;
  const url = new URL(baseURL);
  const warnings: string[] = [];
  if (isLoopbackUrl(baseURL))
    warnings.push(
      `LICTORY_AI_BASE_URL points at ${url.hostname}. Inside a container that is the container itself, not the server: use host.docker.internal for a service on the same machine, or the service's private address. Ignore this when the API and worker run directly on the host.`,
    );
  if (
    env("NODE_ENV", source) === "production" &&
    url.protocol === "http:" &&
    !isPrivateHost(url.hostname)
  )
    warnings.push(
      `LICTORY_AI_BASE_URL uses plain http to ${url.hostname}, which looks like a public address: content would cross the network unencrypted. Use https, or a private address.`,
    );
  return warnings.length ? { warning: warnings.join(" ") } : undefined;
}

// Asks the provider not to keep requests (OpenAI and Azure Responses; Azure
// stores by default). Other providers' retention is their contract with the
// operator, not a request parameter. Keys of other providers are ignored.
export const providerOptions = {
  openai: { store: false },
  azure: { store: false },
} as const;

/**
 * The system instructions for a structured request. In json-object mode the
 * endpoint only promises some JSON object, so the schema is written into the
 * instructions; the answer is still validated against the schema afterwards.
 */
export function structuredSystem(
  config: Pick<AiProviderConfig, "provider" | "structuredOutput">,
  system: string,
  schema: z.ZodType,
) {
  if (
    config.provider !== "openai-compatible" ||
    config.structuredOutput !== "json-object"
  )
    return system;
  return `${system}

Reply with a single JSON object and nothing else. It must match this JSON Schema exactly (every property is required; use null where the schema allows it):
${JSON.stringify(z.toJSONSchema(schema))}`;
}

/**
 * A short, stable identifier of where generated chat steps came from, stored
 * with each assistant message. It names no host and no key.
 */
export function providerFingerprint(
  config: Pick<AiProviderConfig, "provider" | "baseURL">,
) {
  return createHash("sha256")
    .update(`${config.provider} ${config.baseURL}`)
    .digest("hex")
    .slice(0, 16);
}
// Transcripts written before fingerprints existed came from OpenAI.
export const legacyFingerprint = providerFingerprint({
  provider: "openai",
  baseURL: OPENAI_URL,
});

/** For the admin console: where requests go, without credentials. */
export function describeAiProvider(source: Environment = process.env) {
  const resolved = resolveAiProvider(source);
  if (resolved.state !== "configured")
    return {
      state: resolved.state,
      problems: resolved.state === "invalid" ? resolved.problems : [],
    } as const;
  const { config } = resolved;
  const url = new URL(config.baseURL);
  return {
    state: "configured",
    provider: config.provider,
    label: providerCapabilities[config.provider].label,
    protocol: providerCapabilities[config.provider].protocol,
    model: config.model,
    endpoint: `${url.origin}${url.pathname === "/" ? "" : url.pathname}`,
    authenticated: Boolean(config.apiKey),
    keySetting: config.keySetting ?? null,
    structuredOutput: config.structuredOutput,
    timeoutSeconds: config.timeoutMs / 1000,
  } as const;
}

export const OPENAI_REALTIME_URL = OPENAI_URL;

export type TranscriptionResolution =
  | { state: "disabled" }
  | { state: "configured"; apiKey: string; baseUrl: string }
  | { state: "invalid"; problem: string };

// Dictation is a separate destination: audio goes from the browser straight
// to OpenAI's Realtime API, whatever provider handles text. It is on by
// default only when text already goes to OpenAI itself (not a gateway or
// another provider); otherwise the operator opts in explicitly with
// LICTORY_TRANSCRIPTION_PROVIDER=openai and an OPENAI_API_KEY.
export function resolveTranscription(
  source: Environment = process.env,
): TranscriptionResolution {
  const selected = env("LICTORY_TRANSCRIPTION_PROVIDER", source);
  if (selected === "none") return { state: "disabled" };
  if (selected !== undefined && selected !== "openai")
    return {
      state: "invalid",
      problem: `LICTORY_TRANSCRIPTION_PROVIDER must be openai or none, got "${selected}".`,
    };
  const ai = resolveAiProvider(source);
  const plainOpenAi =
    ai.state === "configured" &&
    ai.config.provider === "openai" &&
    ai.config.baseURL === OPENAI_REALTIME_URL
      ? ai.config.apiKey
      : undefined;
  if (selected === undefined)
    return plainOpenAi
      ? {
          state: "configured",
          apiKey: plainOpenAi,
          baseUrl: OPENAI_REALTIME_URL,
        }
      : { state: "disabled" };
  const apiKey = env("OPENAI_API_KEY", source) ?? plainOpenAi;
  if (!apiKey)
    return {
      state: "invalid",
      problem:
        "LICTORY_TRANSCRIPTION_PROVIDER=openai needs OPENAI_API_KEY (an OpenAI key; dictation always uses OpenAI's Realtime API).",
    };
  return { state: "configured", apiKey, baseUrl: OPENAI_REALTIME_URL };
}

export function dictationConfigured(source: Environment = process.env) {
  return resolveTranscription(source).state === "configured";
}

// Startup rule for the API (config/validate.ts).
export function transcriptionRule(source: Environment) {
  const resolved = resolveTranscription(source);
  return resolved.state === "invalid" ? resolved.problem : undefined;
}
