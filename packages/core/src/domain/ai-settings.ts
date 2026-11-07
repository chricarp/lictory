// The AI provider settings instance administrators keep in the database (the
// admin console and `lictory ai setup`). The environment, when it sets any AI
// variable, takes precedence and these are not used (ai/provider-settings.ts).
//
// - Keys are encrypted with the delivery credentials key and never leave the
//   server: the console sees only whether each one is set.
// - A saved key stays with its provider: switching provider never sends the
//   old provider's key to the new one.
// - Every change is validated first (the same rules as the environment) and
//   recorded in the instance audit log, without secrets.
// - Each API and worker process keeps the resolved state in memory
//   (`aiState()`); `watchAiSettings` notices a new version within seconds and
//   refreshes the organizations' directories.
import { eq, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  decryptCredential,
  derivedCredentialsKeyInProduction,
  encryptCredential,
} from "@lictory/core/delivery/credentials";
import {
  aiState,
  aiWarnings,
  environmentState,
  isMetadataAddress,
  resolveText,
  resolveTranscriptionSettings,
  setAiState,
  type AiSettings,
  type AiState,
  type ProviderSettings,
} from "@lictory/core/ai/provider-settings";
import {
  textProviderOf,
  transcriptionProviderOf,
  type AiField,
} from "@lictory/core/contracts/ai-provider";
import type { Database } from "@lictory/core/domain/service";
import {
  aiSettingsInput,
  allFields,
  isSecret,
  mergeSettings,
  type AiSettingsInput,
} from "@lictory/core/ai/settings-input";

export { aiSettingsInput, mergeSettings, type AiSettingsInput };
import {
  InstanceAdminError,
  recordInstanceAudit,
  type InstanceActor,
} from "@lictory/core/domain/instance-admin";
import { refreshAiAvailability } from "@lictory/core/domain/ai";

const ROW = "instance";
// Bound as associated data: the ciphertext only decrypts as these settings.
const AAD = "instance-ai-settings";

type Secrets = Partial<
  Record<"text" | "transcription", Partial<Record<AiField, string>>>
>;

type Stored = {
  settings: AiSettings;
  version: number;
  updatedAt: Date;
  updatedById: string | null;
};

export async function readStoredSettings(db: Database): Promise<Stored | null> {
  const [row] = await db
    .select()
    .from(s.instanceAiSetting)
    .where(eq(s.instanceAiSetting.id, ROW));
  if (!row) return null;
  const plain = row.settings as {
    text?: ProviderSettings | null;
    transcription?: ProviderSettings | null;
    timeoutSeconds?: number;
  };
  const secrets = row.secrets
    ? decryptCredential<Secrets>(AAD, row.secrets)
    : {};
  const join = (
    part: "text" | "transcription",
    value: ProviderSettings | null | undefined,
  ) => (value ? { ...value, ...secrets[part] } : value);
  return {
    settings: {
      text: join("text", plain.text) ?? null,
      transcription: join("transcription", plain.transcription),
      timeoutSeconds: plain.timeoutSeconds,
    },
    version: row.version,
    updatedAt: row.updatedAt,
    updatedById: row.updatedById,
  };
}

/** Resolves stored settings the way the console sees them. */
export function consoleState(stored: Stored, consoleAllowed: boolean): AiState {
  const text = resolveText(stored.settings, "console");
  return {
    source: "console",
    consoleAllowed,
    text,
    transcription: resolveTranscriptionSettings(
      stored.settings,
      text,
      "console",
    ),
    problems: [],
    version: stored.version,
    updatedAt: stored.updatedAt.toISOString(),
    updatedById: stored.updatedById ?? undefined,
  };
}

/** The state this process should use now. */
export async function loadAiState(db: Database): Promise<AiState> {
  const environment = environmentState();
  if (environment.source === "environment" || !environment.consoleAllowed)
    return environment;
  const stored = await readStoredSettings(db);
  return stored ? consoleState(stored, true) : environment;
}

/** Loads the state into this process; returns whether it changed. */
export async function refreshAiState(db: Database) {
  const before = aiState();
  const next = await loadAiState(db);
  setAiState(next);
  return before.source !== next.source || before.version !== next.version;
}

/**
 * Keeps this process's state current: another replica (or the CLI) may save
 * new settings. Refreshes the directories when it changes. Returns a stop
 * function.
 */
export function watchAiSettings(
  db: Database,
  options: {
    intervalMs?: number;
    log?: (event: string, detail: object) => void;
  } = {},
) {
  if (environmentState().source === "environment") return () => undefined;
  const timer = setInterval(() => {
    refreshAiState(db)
      .then(async (changed) => {
        if (!changed) return;
        const refreshed = await refreshAiAvailability(db);
        options.log?.("ai.settings_reloaded", { refreshed });
      })
      .catch((error: unknown) =>
        options.log?.("ai.settings_reload_failed", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
  }, options.intervalMs ?? 10_000);
  timer.unref();
  return () => clearInterval(timer);
}

function editable() {
  const environment = environmentState();
  if (environment.source === "environment")
    throw new InstanceAdminError(
      "managed_by_environment",
      "The server's environment configures Lictory Intelligence (LICTORY_AI_* or OPENAI_API_KEY), so it cannot be changed here. Change it on the server: sudo lictory config set …, or remove those settings to manage it here.",
      409,
    );
  if (!environment.consoleAllowed)
    throw new InstanceAdminError(
      "console_disabled",
      "The operator turned off AI configuration in the admin console (LICTORY_AI_CONSOLE=false).",
      403,
    );
}

// An endpoint typed in the console must not point at instance metadata.
function endpointProblems(settings: AiSettings) {
  const problems: string[] = [];
  for (const [label, part] of [
    ["Base URL", settings.text],
    ["Dictation base URL", settings.transcription],
  ] as const) {
    if (!part?.baseUrl) continue;
    let host: string;
    try {
      host = new URL(part.baseUrl).hostname;
    } catch {
      continue;
    }
    if (isMetadataAddress(host))
      problems.push(
        `${label} points at a link-local or cloud metadata address, which Lictory does not call.`,
      );
  }
  return problems;
}

/** Resolves candidate settings without saving (Test, and before Save). */
export async function candidateState(db: Database, input: AiSettingsInput) {
  editable();
  const stored = await readStoredSettings(db);
  const settings = mergeSettings(stored?.settings ?? null, input);
  const state = consoleState(
    { settings, version: 0, updatedAt: new Date(), updatedById: null },
    true,
  );
  return { settings, state, problems: endpointProblems(settings) };
}

const problemsOf = (state: AiState) => [
  ...(state.text.state === "invalid" ? state.text.problems : []),
  ...(state.transcription.state === "invalid"
    ? state.transcription.problems
    : []),
];

export async function saveAiSettings(
  db: Database,
  actor: InstanceActor,
  input: AiSettingsInput,
) {
  const { settings, state, problems } = await candidateState(db, input);
  const all = [...problems, ...problemsOf(state)];
  if (all.length) throw new InstanceAdminError("validation", all.join(" "));
  const secrets: Secrets = {};
  const plain: Record<string, unknown> = {
    timeoutSeconds: settings.timeoutSeconds,
  };
  for (const name of ["text", "transcription"] as const) {
    const value = settings[name];
    if (!value) {
      plain[name] = value;
      continue;
    }
    const open: ProviderSettings = { provider: value.provider };
    for (const f of allFields) {
      const v = value[f];
      if (v === undefined) continue;
      if (isSecret(f)) (secrets[name] ??= {})[f] = v;
      else open[f] = v;
    }
    plain[name] = open;
  }
  const hasSecrets = Object.keys(secrets).length > 0;
  if (hasSecrets && derivedCredentialsKeyInProduction(process.env)) {
    const [existing] = await db
      .select({ secrets: s.instanceAiSetting.secrets })
      .from(s.instanceAiSetting)
      .where(eq(s.instanceAiSetting.id, ROW));
    if (!existing?.secrets)
      throw new InstanceAdminError(
        "credentials_key_missing",
        "Set DELIVERY_CREDENTIALS_KEY on the server before storing AI keys: they are encrypted with it. See docs/operations/configuration.md.",
        409,
      );
  }
  const encrypted = hasSecrets ? encryptCredential(AAD, secrets) : null;
  const [row] = await db
    .insert(s.instanceAiSetting)
    .values({
      id: ROW,
      settings: plain,
      secrets: encrypted,
      version: 1,
      updatedById: actor.user?.id ?? null,
    })
    .onConflictDoUpdate({
      target: s.instanceAiSetting.id,
      set: {
        settings: plain,
        secrets: encrypted,
        version: sqlIncrement,
        updatedById: actor.user?.id ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  await recordInstanceAudit(
    db,
    actor,
    "ai.configured",
    { type: "ai", id: ROW, label: "AI provider" },
    {
      text: settings.text
        ? {
            provider: settings.text.provider,
            model: settings.text.model ?? null,
            endpoint: originOf(settings.text.baseUrl),
          }
        : null,
      dictation:
        settings.transcription === undefined
          ? "default"
          : settings.transcription
            ? {
                provider: settings.transcription.provider,
                model: settings.transcription.model ?? null,
                endpoint: originOf(settings.transcription.baseUrl),
              }
            : null,
      // Which secrets changed, never their values.
      keysChanged: changedSecrets(input),
    },
  );
  const next = consoleState(
    {
      settings,
      version: row!.version,
      updatedAt: row!.updatedAt,
      updatedById: row!.updatedById,
    },
    true,
  );
  setAiState(next);
  await refreshAiAvailability(db);
  return next;
}

const sqlIncrement = sql`${s.instanceAiSetting.version} + 1`;

function originOf(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function changedSecrets(input: AiSettingsInput) {
  const changed: string[] = [];
  for (const name of ["text", "transcription"] as const) {
    const part = input[name];
    if (!part || part === "default") continue;
    for (const f of ["apiKey", "accessKeyId", "secretAccessKey"] as const)
      if (part[f] !== undefined)
        changed.push(`${name}.${f}${part[f] === "" ? " (cleared)" : ""}`);
  }
  return changed;
}

/** What the console shows: values except secrets, which are only "set". */
export async function aiSettingsView(db: Database) {
  const environment = environmentState();
  const state = aiState();
  const stored =
    environment.source === "environment" ? null : await readStoredSettings(db);
  const view = (value: ProviderSettings | null | undefined) => {
    if (!value) return value;
    const shown: Record<string, string | boolean> = {
      provider: value.provider,
    };
    const spec =
      textProviderOf(value.provider) ?? transcriptionProviderOf(value.provider);
    for (const f of allFields) {
      if (spec && !spec.fields[f]) continue;
      if (isSecret(f)) shown[`${f}Set`] = Boolean(value[f]);
      else if (value[f] !== undefined) shown[f] = value[f];
    }
    return shown;
  };
  return {
    source: environment.source === "environment" ? "environment" : "console",
    editable:
      environment.source !== "environment" && environment.consoleAllowed,
    consoleAllowed: environment.consoleAllowed,
    stored: stored
      ? {
          text: view(stored.settings.text),
          transcription:
            stored.settings.transcription === undefined
              ? "default"
              : view(stored.settings.transcription),
          timeoutSeconds: stored.settings.timeoutSeconds ?? null,
          version: stored.version,
          updatedAt: stored.updatedAt.toISOString(),
        }
      : null,
    problems: problemsOf(state),
    warnings: aiWarnings(state, process.env.NODE_ENV === "production"),
  };
}
