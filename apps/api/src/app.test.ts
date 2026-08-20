import { describe, expect, it } from "vitest";

import { createApp } from "./app";
import type { Env } from "./bindings";

const env = {
  ENVIRONMENT: "development",
  ALLOWED_ORIGINS: "http://localhost:3000",
  BETTER_AUTH_URL: "https://api.lictory.localhost",
  PASSKEY_RP_ID: "localhost",
} as Env;

describe("API composition", () => {
  it("keeps health public and emits a request id", async () => {
    const response = await createApp().request("/health", {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "lictory-api",
    });
  });

  it("protects every v1 feature at the shared boundary", async () => {
    const response = await createApp().request("/v1/search?q=hello", {}, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("mounts feature routes without changing their public paths", async () => {
    const response = await createApp().request(
      "/v1/search",
      { headers: { authorization: "Bearer dev:test-user" } },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ notes: [], entities: [] });
  });
});
