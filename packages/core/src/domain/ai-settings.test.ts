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
