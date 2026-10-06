import assert from "node:assert/strict";
import { test } from "node:test";
import { CapabilityError } from "~/capabilities/core";
import {
  createDictationSession,
  type transcriptionSessionConfig,
} from "./transcription";

void test("requests a transcription-only, short-lived credential without the user id", async () => {
  let sent: { url: string; init: RequestInit } | undefined;
  const session = await createDictationSession("user-123", {
    apiKey: "sk-test",
    fetch: (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return Response.json({ value: "ek_abc", expires_at: 1_900_000_000 });
    }) as typeof fetch,
  });

  assert.deepEqual(session, {
    provider: "openai",
    token: "ek_abc",
    expiresAt: 1_900_000_000,
    callsUrl: "https://api.openai.com/v1/realtime/calls",
  });
  assert.equal(sent?.url, "https://api.openai.com/v1/realtime/client_secrets");
  const headers = sent?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer sk-test");
  assert.match(headers["OpenAI-Safety-Identifier"]!, /^[0-9a-f]{64}$/);
  const raw = sent?.init.body as string;
  const body = JSON.parse(raw) as {
    expires_after: { seconds: number };
    session: ReturnType<typeof transcriptionSessionConfig>;
  };
  assert.ok(!raw.includes("user-123"));
  assert.ok(body.expires_after.seconds <= 60);
  assert.equal(body.session.type, "transcription");
  assert.equal(
    body.session.audio.input.transcription.model,
    "gpt-live-transcribe",
  );
  assert.equal(body.session.audio.input.turn_detection, null);
});

void test("never returns the server key and reports provider refusals actionably", async () => {
  await assert.rejects(
    createDictationSession("u", {
      apiKey: "sk-test",
      fetch: (async () =>
        new Response("nope", { status: 429 })) as unknown as typeof fetch,
    }),
    (e: unknown) =>
      e instanceof CapabilityError &&
      e.category === "unavailable" &&
      e.message.includes("HTTP 429") &&
      !e.message.includes("sk-test"),
  );
});

void test("is unavailable without a configured key", async () => {
  await assert.rejects(
    createDictationSession("u", { apiKey: "" }),
    (e: unknown) =>
      e instanceof CapabilityError && e.category === "unavailable",
  );
});
