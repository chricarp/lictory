import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../../bindings";
import {
  describeImage,
  extractStructure,
  hasOpenAiGateway,
  transcribeAudio,
} from "./extraction";

const env = {
  AI_GATEWAY_ACCOUNT_ID: "account id",
  AI_GATEWAY_ID: "lictory gateway",
  AI_GATEWAY_TOKEN: "gateway-token",
  OPENAI_API_KEY: "openai-key",
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI through Cloudflare AI Gateway", () => {
  it("requires every gateway credential", () => {
    expect(hasOpenAiGateway(env)).toBe(true);
    expect(hasOpenAiGateway({ ...env, OPENAI_API_KEY: undefined })).toBe(false);
  });

  it("extracts structured note context with gpt-5-nano", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Coffee with Ada",
                summary: "Met Ada in Rome.",
                people: [{ name: "Ada" }],
                places: [{ name: "Rome" }],
                times: [],
                organizations: [],
                topics: [{ name: "coffee" }],
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractStructure(
      env,
      "Met Ada for coffee in Rome.",
      "2026-08-19T08:00:00.000Z",
    );

    expect(result.people[0]?.name).toBe("Ada");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account%20id/lictory%20gateway/openai/chat/completions",
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openai-key",
      "cf-aig-authorization": "Bearer gateway-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-5-nano",
      response_format: {
        type: "json_schema",
        json_schema: { name: "note_extraction" },
      },
    });
  });

  it("uses gpt-5-nano for image descriptions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "A red bicycle." } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      describeImage(env, new Uint8Array([1, 2, 3]).buffer, "image/jpeg"),
    ).resolves.toBe("A red bicycle.");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "gpt-5-nano",
    });
  });

  it("sends audio as multipart to gpt-4o-mini-transcribe", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ text: "Remember the tickets." }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudio(
        env,
        new Uint8Array([1, 2, 3]).buffer,
        "memo.m4a",
        "audio/mp4",
      ),
    ).resolves.toBe("Remember the tickets.");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/openai/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect((form.get("file") as File).name).toBe("memo.m4a");
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it("surfaces gateway failures instead of writing an empty extraction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })),
    );

    await expect(
      extractStructure(env, "A note", "2026-08-19T08:00:00.000Z"),
    ).rejects.toThrow(
      "Cloudflare AI Gateway request failed (429): rate limited",
    );
  });
});
