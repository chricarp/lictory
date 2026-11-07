// Which model services Lictory Intelligence talks to: one provider for text
// (reviews, proposal intake, Litto, titles) and optionally one for dictation.
// Organizations only decide whether their content may be sent there
// (`setAiPolicy`).
//
// Settings come from one of two places, never both:
// - the server's environment (LICTORY_AI_*, LICTORY_TRANSCRIPTION_*, or the
//   legacy OPENAI_API_KEY), which then wins and makes the console read-only;
// - otherwise the admin console or `lictory ai setup`, stored encrypted in the
//   database (domain/ai-settings.ts) and editable by instance administrators.
//
// There is no fallback: requests go only to the configured provider, and a
// failure names the setting to check. Nothing is retried elsewhere.
//
// This module is pure (no SDK, no database); ai/provider.ts adds the SDK
// adapters and domain/ai-settings.ts the stored settings.
import { createHash } from "node:crypto";
import { z } from "zod";
import { env, type Environment } from "@lictory/core/lib/env";
import {
  aiFieldLabels,
  aiProviderKinds,
  textProviderIds,
  textProviderOf,
  textProviders,
  transcriptionProviderIds,
  transcriptionProviderOf,
  type AiField,
  type AiProviderKind,
  type TextAdapter,
  type TextProviderId,
  type TranscriptionAdapter,
  type TranscriptionMode,
  type TranscriptionProviderId,
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
export const OPENAI_REALTIME_URL = OPENAI_URL;

// ------------------------------------------------------------------ settings

/** One provider's settings, as typed by the operator. Secrets included. */
export type ProviderSettings = {
  provider: string;
} & Partial<Record<AiField, string>>;

export type AiSettings = {
  text: ProviderSettings | null;
  /**
   * null turns dictation off. Undefined is the default: live OpenAI
   * dictation when text goes to OpenAI's own API, otherwise none.
   */
  transcription?: ProviderSettings | null;
  timeoutSeconds?: number;
};

export type SettingsSource = "environment" | "console";
type Part = "text" | "transcription";

// Names the variables so the configuration scan (config/config.test.ts)
// sees them read.
const setting = (name: string) => name;
const envNames: Record<Part, Partial<Record<AiField | "provider", string>>> = {
  text: {
    provider: setting("LICTORY_AI_PROVIDER"),
    apiKey: setting("LICTORY_AI_API_KEY"),
    baseUrl: setting("LICTORY_AI_BASE_URL"),
    model: setting("LICTORY_AI_MODEL"),
    region: setting("LICTORY_AI_REGION"),
    project: setting("LICTORY_AI_PROJECT"),
    location: setting("LICTORY_AI_LOCATION"),
    accessKeyId: setting("LICTORY_AI_AWS_ACCESS_KEY_ID"),
    secretAccessKey: setting("LICTORY_AI_AWS_SECRET_ACCESS_KEY"),
    structuredOutput: setting("LICTORY_AI_STRUCTURED_OUTPUT"),
  },
  transcription: {
    provider: setting("LICTORY_TRANSCRIPTION_PROVIDER"),
    apiKey: setting("LICTORY_TRANSCRIPTION_API_KEY"),
    baseUrl: setting("LICTORY_TRANSCRIPTION_BASE_URL"),
    model: setting("LICTORY_TRANSCRIPTION_MODEL"),
    project: setting("LICTORY_TRANSCRIPTION_PROJECT"),
    location: setting("LICTORY_TRANSCRIPTION_LOCATION"),
  },
};
const fieldNames = Object.keys(envNames.text).filter(
  (f) => f !== "provider",
) as AiField[];

/** How a message names a setting: its variable, or its console label. */
function named(
  source: SettingsSource,
  part: Part,
  field: AiField | "provider",
) {
  const variable = envNames[part][field];
  if (source === "environment" && variable) return variable;
  const label = field === "provider" ? "Provider" : aiFieldLabels[field];
  // "Dictation model", "Dictation base URL", "Dictation API key".
  const lower = label.replace(/^[A-Z][a-z]/, (c) => c.toLowerCase());
  return part === "text" ? label : `Dictation ${lower}`;
}

/** Every variable this module reads, to tell whether the environment manages AI. */
const aiVariables = [
  ...Object.values(envNames.text),
  ...Object.values(envNames.transcription),
  "LICTORY_AI_TIMEOUT_SECONDS",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as string[];

/**
 * Whether the environment configures AI (any setting present). The console
 * is then read-only: the environment is reviewed and deployed like the rest
 * of the configuration and must not be silently overridden.
 */
export function aiManagedByEnvironment(source: Environment = process.env) {
  return aiVariables.some((name) => env(name, source) !== undefined);
}

/** Whether instance administrators may configure AI in the console. */
export function aiConsoleAllowed(source: Environment = process.env) {
  const value = env("LICTORY_AI_CONSOLE", source)?.toLowerCase();
  return !(value === "false" || value === "no" || value === "0");
}

// Settings that only an explicit provider uses. Setting one without
// LICTORY_AI_PROVIDER is a problem rather than a guess.
const explicitSettings = [
  "LICTORY_AI_BASE_URL",
  "LICTORY_AI_API_KEY",
  "LICTORY_AI_STRUCTURED_OUTPUT",
  "LICTORY_AI_REGION",
  "LICTORY_AI_PROJECT",
  "LICTORY_AI_LOCATION",
  "LICTORY_AI_AWS_ACCESS_KEY_ID",
  "LICTORY_AI_AWS_SECRET_ACCESS_KEY",
] as const;

/** Which variables hold the keys and URLs, for messages naming what to check. */
type KeySettings = Partial<Record<Part | "textUrl", string>>;

/** The environment as settings. Problems are about the variables themselves. */
export function settingsFromEnvironment(source: Environment = process.env): {
  settings: AiSettings;
  problems: string[];
  keySettings: KeySettings;
} {
  const problems: string[] = [];
  const keySettings: KeySettings = {};
  const read = (part: Part, providerId: string): ProviderSettings => {
    const settings: ProviderSettings = { provider: providerId };
    for (const field of fieldNames) {
      const variable = envNames[part][field];
      const value = variable ? env(variable, source) : undefined;
      if (value !== undefined) settings[field] = value;
    }
    if (settings.apiKey) keySettings[part] = envNames[part].apiKey;
    return settings;
  };
  let text: ProviderSettings | null = null;
  const selected = env("LICTORY_AI_PROVIDER", source);
  if (selected === undefined) {
    const stray = explicitSettings.filter((name) => env(name, source));
    if (stray.length)
      problems.push(
        `${stray.join(" and ")} ${stray.length === 1 ? "is" : "are"} set but LICTORY_AI_PROVIDER is not. Choose the provider explicitly (lictory ai providers lists them).`,
      );
    // Existing installations: OPENAI_API_KEY and the SDK's OPENAI_BASE_URL.
    const legacyKey = env("OPENAI_API_KEY", source);
    if (legacyKey && !stray.length) {
      text = { provider: "openai", apiKey: legacyKey };
      keySettings.text = "OPENAI_API_KEY";
      const model = env("LICTORY_AI_MODEL", source);
      if (model) text.model = model;
      const legacyUrl = env("OPENAI_BASE_URL", source);
      if (legacyUrl) {
        text.baseUrl = legacyUrl;
        keySettings.textUrl = "OPENAI_BASE_URL";
      }
    }
  } else {
    text = read("text", selected);
    // The OpenAI key keeps working when the provider is named explicitly;
    // no other provider reads it.
    if (selected === "openai" && !text.apiKey) {
      const legacyKey = env("OPENAI_API_KEY", source);
      if (legacyKey) {
        text.apiKey = legacyKey;
        keySettings.text = "OPENAI_API_KEY";
      }
    }
    if (selected === "openai" && !text.baseUrl) {
      const legacyUrl = env("OPENAI_BASE_URL", source);
      if (legacyUrl) {
        text.baseUrl = legacyUrl;
        keySettings.textUrl = "OPENAI_BASE_URL";
      }
    }
  }
  let transcription: ProviderSettings | null | undefined;
  const dictation = env("LICTORY_TRANSCRIPTION_PROVIDER", source);
  if (dictation === "none") transcription = null;
  else if (dictation !== undefined) {
    transcription = read("transcription", dictation);
    // An OpenAI key in OPENAI_API_KEY serves OpenAI dictation too.
    if (
      !transcription.apiKey &&
      transcriptionProviderOf(dictation)?.vendor === "openai" &&
      env("OPENAI_API_KEY", source) &&
      textProviderOf(text?.provider ?? "")?.vendor !== "openai"
    ) {
      transcription.apiKey = env("OPENAI_API_KEY", source);
      keySettings.transcription = "OPENAI_API_KEY";
    }
  }
  const timeout = env("LICTORY_AI_TIMEOUT_SECONDS", source);
  let timeoutSeconds: number | undefined;
  if (timeout !== undefined) {
    const { minimum, maximum } = AI_TIMEOUT_SECONDS_RANGE;
    const n = Number(timeout);
    if (!/^\d+$/.test(timeout) || n < minimum || n > maximum)
      problems.push(
        `LICTORY_AI_TIMEOUT_SECONDS must be a whole number from ${minimum} to ${maximum}, got "${timeout}".`,
      );
    else timeoutSeconds = n;
  }
  return {
    settings: { text, transcription, timeoutSeconds },
    problems,
    keySettings,
  };
}

// --------------------------------------------------------------- resolution

export type AiProviderConfig = {
  provider: TextProviderId;
  adapter: TextAdapter;
  model: string;
  /** Always explicit, so SDKs never read their own environment defaults. */
  baseURL: string;
  /** Whether the base URL was set rather than the provider's default. */
  customBaseUrl: boolean;
  /** What sets the base URL, for messages. */
  urlSetting: string;
  /** Never logged, never sent to browsers. */
  apiKey?: string;
  /** What holds the key, for messages that name what to check. */
  keySetting?: string;
  region?: string;
  project?: string;
  location?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** A Google service account key, when the key is one. */
  googleCredentials?: Record<string, string>;
  structuredOutput: StructuredOutputMode;
  timeoutMs: number;
  source: SettingsSource;
};

export type AiResolution =
  /** No provider selected: Lictory Intelligence is unavailable, not broken. */
  | { state: "disabled" }
  | { state: "configured"; config: AiProviderConfig }
  /** A selection that cannot work. From the environment, the API and worker do not start. */
  | { state: "invalid"; problems: string[] };

export type TranscriptionConfig = {
  provider: TranscriptionProviderId;
  adapter: TranscriptionAdapter;
  mode: TranscriptionMode;
  model: string;
  baseURL: string;
  customBaseUrl: boolean;
  urlSetting: string;
  apiKey?: string;
  keySetting?: string;
  project?: string;
  location?: string;
  googleCredentials?: Record<string, string>;
  source: SettingsSource;
};

export type TranscriptionResolution =
  | { state: "disabled" }
  | { state: "configured"; config: TranscriptionConfig }
  | { state: "invalid"; problems: string[] };

// Never echoes the value: a URL may carry credentials in its user info or
// query, and these messages reach startup logs and the admin console.
export function baseUrlProblem(
  name: string,
  value: string,
  https: boolean,
  keyName = "the API key setting",
) {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    // Reported below.
  }
  if (url && (url.username || url.password))
    return `${name} must not contain credentials. Put the key in ${keyName}.`;
  if (
    !url ||
    !(https ? ["https:"] : ["http:", "https:"]).includes(url.protocol) ||
    url.search ||
    url.hash
  )
    return `${name} must be an ${https ? "https" : "http(s)"} URL without credentials, query or fragment, such as ${https ? "https://<resource>.openai.azure.com/openai/v1" : "http://inference.internal:11434/v1"}.`;
  return undefined;
}
const trimSlash = (url: string) => url.replace(/\/+$/, "");

// A Google service account key pasted as the "key": its JSON. Anything else
// is an API key.
function googleKey(value: string | undefined) {
  if (!value?.trimStart().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.client_email === "string" &&
      typeof parsed.private_key === "string"
    )
      return parsed as Record<string, string>;
  } catch {
    // Reported by the caller.
  }
  return null;
}

type Spec = {
  label: string;
  vendor: string;
  fields: Partial<Record<AiField, "required" | "optional">>;
  defaultBaseUrl?: string;
  httpsOnly?: boolean;
  defaultModel?: string;
};

// Checks fields common to both parts: required, inapplicable, URL, Google
// and AWS credentials. Returns the values with defaults applied.
function checkFields(
  part: Part,
  source: SettingsSource,
  id: string,
  spec: Spec,
  settings: ProviderSettings,
  problems: string[],
  urlSetting?: string,
) {
  const name = (field: AiField | "provider") =>
    field === "baseUrl" && urlSetting ? urlSetting : named(source, part, field);
  for (const field of fieldNames) {
    const value = settings[field];
    if (value === undefined || value === "") continue;
    if (!spec.fields[field] && source === "environment")
      problems.push(
        `${name(field)} does not apply to ${spec.label} (${name("provider")}=${id}). Remove it.`,
      );
  }
  const google = spec.vendor === "google-cloud";
  const credentials = google ? googleKey(settings.apiKey) : undefined;
  if (credentials === null)
    problems.push(
      `${name("apiKey")} looks like a service account key but is not a valid one (it needs client_email and private_key).`,
    );
  const expressKey = google && settings.apiKey && credentials === undefined;
  const project =
    settings.project ??
    (credentials ? credentials.project_id : undefined) ??
    undefined;
  for (const [field, need] of Object.entries(spec.fields) as [
    AiField,
    string,
  ][]) {
    if (need !== "required" || settings[field]) continue;
    if (field === "model" && spec.defaultModel) continue;
    if (field === "baseUrl" && spec.defaultBaseUrl) continue;
    problems.push(
      field === "model" && id === "azure"
        ? `${name("model")} is required for Azure OpenAI: the name of your model deployment.`
        : field === "baseUrl" && id === "azure"
          ? `${name("baseUrl")} is required for Azure OpenAI, such as https://<resource>.openai.azure.com/openai/v1.`
          : `${name(field)} is required for ${spec.label}.`,
    );
  }
  if (google && !expressKey) {
    if (!project)
      problems.push(
        `${name("project")} is required for ${spec.label} unless the key is an API key or a service account key naming its project.`,
      );
    if (!settings.location)
      problems.push(
        `${name("location")} is required for ${spec.label} unless the key is an API key (for example us-central1 or global).`,
      );
  }
  if (
    spec.vendor === "aws" &&
    !settings.accessKeyId !== !settings.secretAccessKey
  )
    problems.push(
      `${name("accessKeyId")} and ${name("secretAccessKey")} go together: set both, or neither to use a Bedrock API key or the server's own AWS identity.`,
    );
  if (spec.vendor === "aws" && settings.apiKey && settings.accessKeyId)
    problems.push(
      `Use either ${name("apiKey")} (a Bedrock API key) or an access key pair, not both.`,
    );
  if (settings.baseUrl) {
    const problem = baseUrlProblem(
      name("baseUrl"),
      settings.baseUrl,
      spec.httpsOnly ?? false,
      urlSetting === "OPENAI_BASE_URL" ? "OPENAI_API_KEY" : name("apiKey"),
    );
    if (problem) problems.push(problem);
  }
  const baseURL = trimSlash(
    settings.baseUrl ??
      spec.defaultBaseUrl ??
      (spec.vendor === "aws"
        ? `https://bedrock-runtime.${settings.region ?? "us-east-1"}.amazonaws.com`
        : google
          ? expressKey
            ? "https://aiplatform.googleapis.com"
            : `https://${settings.location === "global" || !settings.location ? "" : `${settings.location}-`}aiplatform.googleapis.com`
          : ""),
  );
  return {
    baseURL,
    customBaseUrl: Boolean(settings.baseUrl),
    urlSetting: name("baseUrl"),
    project: expressKey ? undefined : project,
    location: expressKey ? undefined : settings.location,
    googleCredentials: credentials ?? undefined,
  };
}

/** The text provider for these settings, with every problem at once. */
export function resolveText(
  settings: AiSettings,
  source: SettingsSource,
  origin: { keySetting?: string; urlSetting?: string } = {},
): AiResolution {
  const { keySetting } = origin;
  const text = settings.text;
  if (!text) return { state: "disabled" };
  const name = (field: AiField | "provider") => named(source, "text", field);
  const spec = textProviderOf(text.provider);
  if (!spec)
    return {
      state: "invalid",
      problems: [
        `${name("provider")} must be one of ${textProviderIds.join(", ")}, got "${text.provider}".`,
      ],
    };
  const id = text.provider as TextProviderId;
  const problems: string[] = [];
  const checked = checkFields(
    "text",
    source,
    id,
    spec,
    text,
    problems,
    origin.urlSetting,
  );
  const mode = text.structuredOutput;
  let structuredOutput: StructuredOutputMode =
    spec.structuredOutput === "json-object" ? "json-object" : "json-schema";
  if (mode !== undefined && mode !== "") {
    if (spec.structuredOutput !== "configurable") {
      if (source === "environment")
        problems.push(
          `${name("structuredOutput")} applies only to self-hosted and OpenAI-compatible endpoints; ${spec.label} always uses its own structured output. Remove it.`,
        );
    } else if (!(structuredOutputModes as readonly string[]).includes(mode))
      problems.push(
        `${name("structuredOutput")} must be one of ${structuredOutputModes.join(", ")}, got "${mode}".`,
      );
    else structuredOutput = mode as StructuredOutputMode;
  }
  if (problems.length) return { state: "invalid", problems };
  return {
    state: "configured",
    config: {
      provider: id,
      adapter: spec.adapter,
      model: text.model ?? spec.defaultModel ?? DEFAULT_AI_MODEL,
      ...checked,
      apiKey: checked.googleCredentials ? undefined : text.apiKey,
      keySetting:
        text.apiKey || checked.googleCredentials
          ? (keySetting ?? name("apiKey"))
          : undefined,
      region: text.region,
      accessKeyId: text.accessKeyId,
      secretAccessKey: text.secretAccessKey,
      structuredOutput,
      timeoutMs: (settings.timeoutSeconds ?? DEFAULT_AI_TIMEOUT_SECONDS) * 1000,
      source,
    },
  };
}

/** Dictation for these settings; a provider of the text's vendor shares its key. */
export function resolveTranscriptionSettings(
  settings: AiSettings,
  text: AiResolution,
  source: SettingsSource,
  options: { keySetting?: string; defaultModel?: string } = {},
): TranscriptionResolution {
  const chosen = settings.transcription;
  if (chosen === null) return { state: "disabled" };
  const name = (field: AiField | "provider") =>
    named(source, "transcription", field);
  if (chosen === undefined) {
    // The default: live dictation when text goes to OpenAI's own API.
    if (
      text.state !== "configured" ||
      text.config.provider !== "openai" ||
      text.config.baseURL !== OPENAI_URL ||
      !text.config.apiKey
    )
      return { state: "disabled" };
    return {
      state: "configured",
      config: {
        provider: "openai-realtime",
        adapter: "openai-realtime",
        mode: "realtime",
        model: options.defaultModel ?? "gpt-live-transcribe",
        baseURL: OPENAI_URL,
        customBaseUrl: false,
        urlSetting: named(source, "transcription", "baseUrl"),
        apiKey: text.config.apiKey,
        keySetting: text.config.keySetting,
        source,
      },
    };
  }
  const spec = transcriptionProviderOf(chosen.provider);
  if (!spec)
    return {
      state: "invalid",
      problems: [
        `${name("provider")} must be one of ${[...transcriptionProviderIds, "none"].join(", ")}, got "${chosen.provider}".`,
      ],
    };
  const id = chosen.provider as TranscriptionProviderId;
  // Same vendor as the text provider: its key, endpoint and project are
  // reused for anything left empty.
  const textSettings = settings.text;
  const shared =
    text.state === "configured" &&
    textSettings &&
    textProviderOf(textSettings.provider)?.vendor === spec.vendor &&
    spec.vendor !== "self-hosted";
  const merged: ProviderSettings = { ...chosen };
  let keySetting = options.keySetting;
  if (shared) {
    for (const field of ["apiKey", "project", "location", "region"] as const)
      if (!merged[field] && textSettings[field] && spec.fields[field]) {
        merged[field] = textSettings[field];
        if (field === "apiKey") keySetting = text.config.keySetting;
      }
    // A gateway or resource endpoint in front of the vendor serves both:
    // audio never goes to the vendor's public API behind the operator's back.
    if (!merged.baseUrl && spec.fields.baseUrl && textSettings.baseUrl)
      merged.baseUrl = textSettings.baseUrl;
  }
  const problems: string[] = [];
  const checked = checkFields(
    "transcription",
    source,
    id,
    spec,
    merged,
    problems,
  );
  if (problems.length) return { state: "invalid", problems };
  return {
    state: "configured",
    config: {
      provider: id,
      adapter: spec.adapter,
      mode: spec.mode,
      model: merged.model ?? spec.defaultModel ?? "",
      ...checked,
      apiKey: checked.googleCredentials ? undefined : merged.apiKey,
      keySetting:
        merged.apiKey || checked.googleCredentials
          ? (keySetting ?? name("apiKey"))
          : undefined,
      source,
    },
  };
}

// ------------------------------------------------------------------ runtime

/** What this process uses now: resolved, with where it came from. */
export type AiState = {
  source: SettingsSource | "none";
  consoleAllowed: boolean;
  text: AiResolution;
  transcription: TranscriptionResolution;
  /** Problems with the settings themselves (environment variables). */
  problems: string[];
  /** Stored settings' version; 0 for the environment. */
  version: number;
  updatedAt?: string;
  updatedById?: string;
};

/** Resolves an environment, the way the API and worker read theirs. */
export function environmentState(source: Environment = process.env): AiState {
  const { settings, problems, keySettings } = settingsFromEnvironment(source);
  const text = problems.length
    ? ({ state: "invalid", problems } as const)
    : resolveText(settings, "environment", {
        keySetting: keySettings.text,
        urlSetting: keySettings.textUrl,
      });
  const transcription = resolveTranscriptionSettings(
    settings,
    text,
    "environment",
    {
      keySetting: keySettings.transcription,
      defaultModel: env("LICTORY_TRANSCRIPTION_MODEL", source),
    },
  );
  return {
    source: aiManagedByEnvironment(source) ? "environment" : "none",
    consoleAllowed: aiConsoleAllowed(source),
    text,
    transcription,
    problems,
    version: 0,
  };
}

let current: AiState | undefined;

/**
 * The AI state of this process: stored settings once domain/ai-settings.ts
 * loaded them, otherwise the environment. Synchronous on purpose: every
 * request reads it, and the loader refreshes it in the background.
 */
export function aiState(): AiState {
  return current ?? environmentState();
}
/** Replaces the process's state (domain/ai-settings.ts, tests). */
export function setAiState(state: AiState | undefined) {
  current = state;
}

/** The configured text provider: of this environment, or of the process. */
export function resolveAiProvider(source?: Environment): AiResolution {
  return source ? environmentState(source).text : aiState().text;
}
export function aiProvider(source?: Environment) {
  const resolved = resolveAiProvider(source);
  return resolved.state === "configured" ? resolved.config : undefined;
}
export function aiConfigured(source?: Environment) {
  return aiProvider(source) !== undefined;
}
export function resolveTranscription(
  source?: Environment,
): TranscriptionResolution {
  return source
    ? environmentState(source).transcription
    : aiState().transcription;
}
export function dictationConfig(source?: Environment) {
  const resolved = resolveTranscription(source);
  return resolved.state === "configured" ? resolved.config : undefined;
}
export function dictationConfigured(source?: Environment) {
  return dictationConfig(source) !== undefined;
}

// -------------------------------------------------------------- networking

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
export function isPrivateHost(hostname: string) {
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
 * Addresses no model endpoint lives at, but cloud instance metadata does
 * (credentials of the machine). An endpoint entered in the console may be
 * any public or private address except these; the environment is the
 * operator's own and is not restricted.
 */
export function isMetadataAddress(address: string) {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "");
  const ip = ipv4(host);
  if (ip) {
    const [a, b, c, d] = ip as [number, number, number, number];
    return (
      (a === 169 && b === 254) ||
      (a === 100 && b === 100 && c === 100 && d === 200) ||
      a === 0
    );
  }
  return (
    /^fe[89ab][0-9a-f]:/.test(host) ||
    host === "fd00:ec2::254" ||
    host.startsWith("::ffff:169.254.") ||
    host === "metadata.google.internal" ||
    host === "metadata"
  );
}

function urlWarnings(
  name: string,
  baseURL: string,
  customBaseUrl: boolean,
  production: boolean,
) {
  if (!customBaseUrl) return [];
  const url = new URL(baseURL);
  const warnings: string[] = [];
  if (isLoopbackUrl(baseURL))
    warnings.push(
      `${name} points at ${url.hostname}. Inside a container that is the container itself, not the server: use host.docker.internal for a service on the same machine, or the service's private address. Ignore this when the API and worker run directly on the host.`,
    );
  if (production && url.protocol === "http:" && !isPrivateHost(url.hostname))
    warnings.push(
      `${name} uses plain http to ${url.hostname}, which looks like a public address: content would cross the network unencrypted. Use https, or a private address.`,
    );
  return warnings;
}

/** Warnings for working but risky settings, for startup and the console. */
export function aiWarnings(state: AiState, production: boolean) {
  const warnings: string[] = [];
  if (state.text.state === "configured") {
    const { config } = state.text;
    warnings.push(
      ...urlWarnings(
        config.urlSetting,
        config.baseURL,
        config.customBaseUrl,
        production,
      ),
    );
  }
  if (state.transcription.state === "configured") {
    const { config } = state.transcription;
    warnings.push(
      ...urlWarnings(
        config.urlSetting,
        config.baseURL,
        config.customBaseUrl,
        production,
      ),
    );
  }
  return warnings;
}

/**
 * Startup rule for the API and the worker (config/validate.ts): an invalid
 * environment stops them; risky but working settings warn. Settings stored
 * from the console never stop a service: they are checked when saved.
 */
export function aiProviderRule(source: Environment) {
  const state = environmentState(source);
  const problems = [
    ...(state.text.state === "invalid" ? state.text.problems : []),
    ...(state.transcription.state === "invalid"
      ? state.transcription.problems
      : []),
  ];
  if (problems.length)
    return `Lictory Intelligence is misconfigured: ${problems.join(" ")} See docs/operations/ai-providers.md.`;
  const warnings = aiWarnings(state, env("NODE_ENV", source) === "production");
  return warnings.length ? { warning: warnings.join(" ") } : undefined;
}

// ----------------------------------------------------------- request shape

// Asks the provider not to keep requests (OpenAI and Azure Responses; Azure
// stores by default). Other providers' retention is their contract with the
// operator, not a request parameter. Keys of other providers are ignored.
export const providerOptions = {
  openai: { store: false },
  azure: { store: false },
} as const;

/**
 * The system instructions for a structured request. In JSON mode the
 * endpoint only promises some JSON object, so the schema is written into the
 * instructions; the answer is still validated against the schema afterwards.
 */
export function structuredSystem(
  config: Pick<AiProviderConfig, "structuredOutput">,
  system: string,
  schema: z.ZodType,
) {
  if (config.structuredOutput !== "json-object") return system;
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
  const adapter = textProviderOf(config.provider)?.adapter ?? config.provider;
  return createHash("sha256")
    .update(`${adapter} ${config.baseURL}`)
    .digest("hex")
    .slice(0, 16);
}
// Transcripts written before fingerprints existed came from OpenAI.
export const legacyFingerprint = providerFingerprint({
  provider: "openai",
  baseURL: OPENAI_URL,
});

// ---------------------------------------------------------------- describe

function endpointOf(baseURL: string) {
  try {
    const url = new URL(baseURL);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return baseURL;
  }
}

/** For the admin console and the CLI: where requests go, without credentials. */
export function describeAiProvider(source?: Environment) {
  const resolved = resolveAiProvider(source);
  if (resolved.state !== "configured")
    return {
      state: resolved.state,
      problems: resolved.state === "invalid" ? resolved.problems : [],
    } as const;
  const { config } = resolved;
  const spec = textProviders[config.provider];
  return {
    state: "configured",
    provider: config.provider,
    label: spec.label,
    hosting: spec.hosting,
    protocol: spec.protocol,
    model: config.model,
    endpoint: endpointOf(config.baseURL),
    authenticated: Boolean(
      !!config.apiKey || !!config.accessKeyId || !!config.googleCredentials,
    ),
    keySetting: config.keySetting ?? null,
    region: config.region ?? null,
    project: config.project ?? null,
    location: config.location ?? null,
    structuredOutput: config.structuredOutput,
    timeoutSeconds: config.timeoutMs / 1000,
    source: config.source,
  } as const;
}

export function describeTranscription(source?: Environment) {
  const resolved = resolveTranscription(source);
  if (resolved.state !== "configured")
    return {
      state: resolved.state,
      problems: resolved.state === "invalid" ? resolved.problems : [],
    } as const;
  const { config } = resolved;
  const spec = transcriptionProviderOf(config.provider)!;
  return {
    state: "configured",
    provider: config.provider,
    label: spec.label,
    hosting: spec.hosting,
    mode: config.mode,
    model: config.model,
    endpoint: endpointOf(config.baseURL),
    authenticated: !!config.apiKey || !!config.googleCredentials,
    keySetting: config.keySetting ?? null,
    source: config.source,
  } as const;
}
