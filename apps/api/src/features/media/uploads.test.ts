import { describe, expect, it } from "vitest";

import type { Env } from "../../bindings";
import { publicApiOrigin, signMediaUrl, verifyMediaUrl } from "./uploads";

describe("publicApiOrigin", () => {
  it("uses the configured public origin behind an HTTP upstream proxy", () => {
    const env = {
      BETTER_AUTH_URL: "https://api.lictory.localhost",
    } as Env;

    expect(publicApiOrigin(env, "http://api.lictory.localhost")).toBe(
      "https://api.lictory.localhost",
    );
  });

  it("normalizes the configured URL to an origin", () => {
    const env = {
      BETTER_AUTH_URL: "https://api.lictory.localhost/api/auth",
    } as Env;

    expect(publicApiOrigin(env, "http://127.0.0.1:8787")).toBe(
      "https://api.lictory.localhost",
    );
  });
});

describe("private media URL signing", () => {
  it("uses the local secret when the configured development secret is empty", async () => {
    const env = {
      ENVIRONMENT: "development",
      BETTER_AUTH_SECRET: "",
    } as Env;

    const signedUrl = await signMediaUrl(
      env,
      "https://api.lictory.localhost",
      "asset-1",
      "user-1",
    );
    const url = new URL(signedUrl);

    await expect(
      verifyMediaUrl(
        env,
        "asset-1",
        url.searchParams.get("u"),
        url.searchParams.get("e"),
        url.searchParams.get("s"),
      ),
    ).resolves.toBe(true);
  });

  it("does not use a predictable fallback outside development", async () => {
    const env = {
      ENVIRONMENT: "production",
      BETTER_AUTH_SECRET: "",
    } as Env;

    await expect(
      signMediaUrl(env, "https://api.lictory.com", "asset-1", "user-1"),
    ).rejects.toThrow("BETTER_AUTH_SECRET is required");
  });
});
