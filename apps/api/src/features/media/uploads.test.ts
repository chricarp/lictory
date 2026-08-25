import { describe, expect, it } from "vitest";

import type { Env } from "../../bindings";
import {
  mediaKindFor,
  publicApiOrigin,
  signMediaUrl,
  verifyMediaUrl,
} from "./uploads";

describe("mediaKindFor", () => {
  it("accepts AnyDoc formats even when the browser reports a generic MIME type", () => {
    expect(mediaKindFor("application/octet-stream", "brief.docm")).toBe(
      "document",
    );
    expect(mediaKindFor("application/octet-stream", "slides.odp")).toBe(
      "document",
    );
    expect(mediaKindFor("", "book.epub")).toBe("document");
  });

  it("does not treat an arbitrary binary file as a document", () => {
    expect(mediaKindFor("application/octet-stream", "payload.bin")).toBeNull();
  });
});

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

  it("signs the browser-facing origin, not the proxied upstream one", async () => {
    const env = {
      ENVIRONMENT: "development",
      BETTER_AUTH_SECRET: "secret",
      BETTER_AUTH_URL: "https://api.lictory.localhost",
    } as Env;

    // The local HTTPS proxy forwards to the Worker over plain HTTP; an http URL
    // inside an https page is blocked as mixed content, so it must not leak out.
    const signedUrl = await signMediaUrl(
      env,
      "http://localhost:8787",
      "asset-1",
      "user-1",
    );

    expect(new URL(signedUrl).origin).toBe("https://api.lictory.localhost");
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
