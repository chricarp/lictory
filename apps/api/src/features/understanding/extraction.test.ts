import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../../bindings";
import {
  answerFromNoteContext,
  describeImage,
  extractStructure,
  hasOpenAiConfiguration,
  synthesizeAskConversationTitle,
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

describe("OpenAI requests", () => {
  it("requires an OpenAI API key", () => {
    expect(hasOpenAiConfiguration(env)).toBe(true);
    expect(hasOpenAiConfiguration({ ...env, OPENAI_API_KEY: undefined })).toBe(
      false,
    );
  });

  it("uses OpenAI directly when Cloudflare AI Gateway is not configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ text: "Remember the tickets." }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeAudio(
      {
        OPENAI_API_KEY: "openai-key",
      } as Env,
      new Uint8Array([1, 2, 3]).buffer,
      "memo.webm",
      "audio/webm",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openai-key",
    });
    expect(init.headers).not.toHaveProperty("cf-aig-authorization");
  });

  it("extracts structured note context with gpt-5.4-nano", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Coffee with Ada",
                summary: "Met Ada in Rome.",
                analysis: "Ada and I met for coffee.",
                people: [
                  {
                    name: "Ada",
                    description: "Coffee companion",
                    mention: "Ada",
                    confidence: 0.95,
                  },
                ],
                places: [
                  {
                    name: "Rome",
                    address: null,
                    latitude: null,
                    longitude: null,
                    description: "Meeting city",
                    mention: "Rome",
                    confidence: 0.95,
                  },
                ],
                times: [],
                organizations: [],
                topics: [
                  {
                    name: "coffee",
                    confidence: 0.8,
                  },
                ],
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
      "Europe/Rome",
    );

    expect(result.people[0]?.name).toBe("Ada");
    expect(result.topics[0]).toEqual({ name: "coffee", confidence: 0.8 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://gateway.ai.cloudflare.com/v1/account%20id/lictory%20gateway/openai/chat/completions",
    );
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openai-key",
      "cf-aig-authorization": "Bearer gateway-token",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string) as {
      response_format: {
        json_schema: {
          schema: {
            properties: {
              topics: { items: { properties: Record<string, unknown> } };
            };
          };
        };
      };
    };
    expect(body).toMatchObject({
      model: "gpt-5.4-nano",
      reasoning_effort: "none",
      response_format: {
        type: "json_schema",
        json_schema: { name: "note_extraction" },
      },
    });
    expect(
      body.response_format.json_schema.schema.properties.topics.items
        .properties,
    ).not.toHaveProperty("description");
  });

  it("uses gpt-5.4-nano for image descriptions", async () => {
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
      model: "gpt-5.4-nano",
      reasoning_effort: "none",
    });
  });

  it("keeps prior turns in a grounded Ask completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "Sam chose Rome. [1]" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await answerFromNoteContext(
      env,
      "Where did they choose?",
      [{ index: 1, title: "Planning", context: "Sam chose Rome." }],
      [
        { role: "user", content: "What did Sam decide?" },
        { role: "assistant", content: "Sam chose a destination. [1]" },
      ],
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages.slice(1, 3)).toEqual([
      { role: "user", content: "What did Sam decide?" },
      { role: "assistant", content: "Sam chose a destination. [1]" },
    ]);
    expect(body.messages.at(-1)?.content).toContain("Current question");
    expect(body.messages.at(-1)?.content).toContain("Sam chose Rome");
  });

  it("normalizes an AI-synthesized Ask title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: '"Launch decisions!"' } }],
        }),
      ),
    );

    await expect(
      synthesizeAskConversationTitle(env, [
        { role: "user", content: "What did we decide about the launch?" },
      ]),
    ).resolves.toBe("Launch decisions");
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
      extractStructure(
        env,
        "A note",
        "2026-08-19T08:00:00.000Z",
        "Europe/Rome",
      ),
    ).rejects.toThrow(
      "Cloudflare AI Gateway request failed (429): rate limited",
    );
  });
});
