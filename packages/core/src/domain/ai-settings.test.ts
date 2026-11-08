import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Directory } from "@lictory/core/contracts/protocol";
import { executeMutation } from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  aiSettingsView,
  loadAiState,
  readStoredSettings,
  refreshAiState,
  saveAiSettings,
} from "@lictory/core/domain/ai-settings";
import { aiState, setAiState } from "@lictory/core/ai/provider-settings";
import type { InstanceActor } from "@lictory/core/domain/instance-admin";

// Settings an instance administrator keeps in the database (the admin
// console and `lictory ai setup`).

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_ai_settings_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;

const aiVariables = () =>
  Object.keys(process.env).filter(
    (k) =>
      k.startsWith("LICTORY_AI_") ||
      k.startsWith("LICTORY_TRANSCRIPTION_") ||
      k.startsWith("OPENAI_"),
  );
const saved = Object.fromEntries(aiVariables().map((k) => [k, process.env[k]]));
const actor: InstanceActor = {
  user: {
    id: crypto.randomUUID(),
    name: "Ines Admin",
    email: "ines@example.test",
  },
  via: "web",
};

before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(() => {
  for (const k of aiVariables()) delete process.env[k];
  setAiState(undefined);
});
after(async () => {
  for (const k of aiVariables()) delete process.env[k];
  Object.assign(process.env, saved);
  setAiState(undefined);
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

async function organization() {
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Ada", email: `${userId}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Northwind",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: "owner",
    createdAt: new Date(),
  });
  await seedOrganization(db, organizationId);
  await executeMutation(
    db,
    { userId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Payments",
        key: "PAY",
      },
    },
  );
  return async () => {
    const [row] = await db
      .select({ data: s.syncEntity.data })
      .from(s.syncEntity)
      .where(
        and(
          eq(s.syncEntity.organizationId, organizationId),
          eq(s.syncEntity.type, "directory"),
        ),
      );
    return (row!.data as unknown as Directory).ai;
  };
}

void test("saved settings take effect at once, with keys encrypted and only flagged in the view", async () => {
  const ai = await organization();
  assert.equal((await ai()).available, false);
  await saveAiSettings(db, actor, {
    text: {
      provider: "anthropic",
      apiKey: "sk-ant-secret-1",
      model: "claude-sonnet-5-5",
    },
    transcription: { provider: "deepgram", apiKey: "dg-secret-2" },
  });
  // This process uses them now; organizations see where content goes.
  assert.equal(aiState().source, "console");
  assert.equal(aiState().text.state, "configured");
  assert.deepEqual(await ai(), {
    enabled: false,
    available: true,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    customEndpoint: false,
    dictation: true,
    dictationMode: "segments",
    dictationProvider: "deepgram",
    dictationCustomEndpoint: false,
  });
  // At rest: no key in plain text.
  const [row] = await db.select().from(s.instanceAiSetting);
  assert.ok(!JSON.stringify(row).includes("sk-ant-secret-1"));
  assert.ok(!JSON.stringify(row).includes("dg-secret-2"));
  assert.equal(
    (await readStoredSettings(db))!.settings.text?.apiKey,
    "sk-ant-secret-1",
  );
  // The console sees that a key is set, never the key.
  const view = await aiSettingsView(db);
  assert.ok(!JSON.stringify(view).includes("sk-ant-secret-1"));
  assert.ok(!JSON.stringify(view).includes("dg-secret-2"));
  assert.equal((view.stored!.text as Record<string, unknown>).apiKeySet, true);
  // The audit names the change, not the secrets.
  const [audit] = await db
    .select()
    .from(s.instanceAuditEvent)
    .where(eq(s.instanceAuditEvent.action, "ai.configured"));
  assert.equal(audit!.actorEmail, "ines@example.test");
  assert.ok(!JSON.stringify(audit).includes("secret-"));
  assert.match(JSON.stringify(audit!.detail), /text\.apiKey/);
});

void test("another replica picks up a change from the database", async () => {
  await saveAiSettings(db, actor, {
    text: { provider: "ollama", model: "qwen3:32b" },
    transcription: null,
  });
  const version = aiState().version;
  // A process that has not seen it yet.
  setAiState(undefined);
  assert.equal(await refreshAiState(db), true);
  assert.equal(aiState().version, version);
  const loaded = await loadAiState(db);
  assert.equal(
    loaded.text.state === "configured" && loaded.text.config.baseURL,
    "http://host.docker.internal:11434/v1",
  );
  assert.equal(loaded.transcription.state, "disabled");
});

void test("invalid settings and metadata endpoints are refused before anything is stored", async () => {
  const before = (await readStoredSettings(db))?.version;
  await assert.rejects(
    saveAiSettings(db, actor, {
      text: { provider: "azure", apiKey: "k" },
      transcription: null,
    }),
    /Model is required for Azure OpenAI/,
  );
  await assert.rejects(
    saveAiSettings(db, actor, {
      text: {
        provider: "openai-compatible",
        model: "m",
        baseUrl: "http://169.254.169.254/v1",
      },
      transcription: null,
    }),
    /link-local or cloud metadata/,
  );
  assert.equal((await readStoredSettings(db))?.version, before);
});

void test("when the environment configures AI, the console cannot change it", async () => {
  process.env.LICTORY_AI_PROVIDER = "ollama";
  process.env.LICTORY_AI_MODEL = "llama3.3:70b";
  try {
    await assert.rejects(
      saveAiSettings(db, actor, {
        text: { provider: "openai", apiKey: "sk" },
        transcription: null,
      }),
      /environment configures Lictory Intelligence/,
    );
    const state = await loadAiState(db);
    assert.equal(state.source, "environment");
    assert.equal(
      state.text.state === "configured" && state.text.config.model,
      "llama3.3:70b",
    );
    assert.equal((await aiSettingsView(db)).editable, false);
  } finally {
    delete process.env.LICTORY_AI_PROVIDER;
    delete process.env.LICTORY_AI_MODEL;
  }
  process.env.LICTORY_AI_CONSOLE = "false";
  try {
    await assert.rejects(
      saveAiSettings(db, actor, { text: null, transcription: null }),
      /LICTORY_AI_CONSOLE=false/,
    );
    // Locked down: stored settings are not used either.
    assert.equal((await loadAiState(db)).text.state, "disabled");
  } finally {
    delete process.env.LICTORY_AI_CONSOLE;
  }
});

void test("turning AI off removes the stored keys", async () => {
  await saveAiSettings(db, actor, {
    text: {
      provider: "mistral",
      apiKey: "mistral-secret",
      model: "mistral-large-latest",
    },
    transcription: "default",
  });
  await saveAiSettings(db, actor, { text: null, transcription: null });
  const [row] = await db.select().from(s.instanceAiSetting);
  assert.equal(row!.secrets, null);
  assert.equal(aiState().text.state, "disabled");
});

void test("keys that no longer decrypt are reported, kept until replaced or removed on purpose, and AI can still be turned off", async () => {
  const previousKey = process.env.DELIVERY_CREDENTIALS_KEY;
  const settings = (
    text: Record<string, string> = {},
    dictation: Record<string, string> = {},
  ) => ({
    text: {
      provider: "llamacpp",
      baseUrl: "http://inference.internal:8080/v1",
      model: "qwen3",
      ...text,
    },
    transcription: {
      provider: "speaches",
      baseUrl: "http://inference.internal:8000/v1",
      model: "Systran/faster-whisper-large-v3",
      ...dictation,
    },
  });
  const refused =
    (message: RegExp) => (error: { code?: string; message?: string }) =>
      error.code === "keys_unreadable" && message.test(error.message ?? "");
  try {
    process.env.DELIVERY_CREDENTIALS_KEY = "the-key-the-keys-were-saved-with";
    await saveAiSettings(
      db,
      actor,
      settings({ apiKey: "llama-secret" }, { apiKey: "speaches-secret" }),
    );
    process.env.DELIVERY_CREDENTIALS_KEY = "a-different-key-after-a-rotation";

    // Loading never throws: the providers are reported unusable, with the fix.
    assert.equal((await loadAiState(db)).text.state, "invalid");
    await refreshAiState(db);
    const view = await aiSettingsView(db);
    assert.match(view.problems.join(" "), /cannot be decrypted/);
    assert.equal(view.problems.length, 1);
    // Still stored, so the console offers to remove them.
    assert.deepEqual(
      [view.stored?.text, view.stored?.transcription].map(
        (p) => (p as Record<string, unknown>).apiKeySet,
      ),
      [true, true],
    );

    // Saving without a decision about every key would lose the rest.
    const [before] = await db.select().from(s.instanceAiSetting);
    await assert.rejects(
      saveAiSettings(db, actor, settings({ model: "qwen3-coder" })),
      refused(/language model API key, dictation API key/),
    );
    await assert.rejects(
      saveAiSettings(db, actor, settings({ apiKey: "llama-new-secret" })),
      refused(/enter or remove: dictation API key\.$/),
    );
    const [unchanged] = await db.select().from(s.instanceAiSetting);
    assert.equal(unchanged!.secrets, before!.secrets);

    // Entering one key and removing the other is a decision about both.
    await saveAiSettings(
      db,
      actor,
      settings({ apiKey: "llama-new-secret" }, { apiKey: "" }),
    );
    assert.equal(aiState().text.state, "configured");
    const stored = (await readStoredSettings(db))!.settings;
    assert.equal(stored.text!.apiKey, "llama-new-secret");
    assert.equal(stored.transcription!.apiKey, undefined);

    // Switching a provider decides for its keys; turning AI off always works.
    process.env.DELIVERY_CREDENTIALS_KEY = "yet-another-key-after-rotation";
    await saveAiSettings(db, actor, {
      text: { provider: "ollama", model: "qwen3" },
      transcription: null,
    });
    process.env.DELIVERY_CREDENTIALS_KEY = "one-more-key-after-rotation";
    await saveAiSettings(db, actor, { text: null, transcription: null });
    assert.equal(aiState().text.state, "disabled");
  } finally {
    if (previousKey === undefined) delete process.env.DELIVERY_CREDENTIALS_KEY;
    else process.env.DELIVERY_CREDENTIALS_KEY = previousKey;
  }
});
