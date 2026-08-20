import { type Extraction, extractionSchema } from "@lictory/contracts";

import type { Env } from "../../bindings";

const TEXT_MODEL = "gpt-5-nano";
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
};

type Transcription = { text?: string };

type GatewayConfig = {
  baseUrl: string;
  headers: Record<string, string>;
};

function gatewayConfig(env: Env): GatewayConfig | null {
  if (
    !env.AI_GATEWAY_ACCOUNT_ID ||
    !env.AI_GATEWAY_ID ||
    !env.AI_GATEWAY_TOKEN ||
    !env.OPENAI_API_KEY
  ) {
    return null;
  }

  const accountId = encodeURIComponent(env.AI_GATEWAY_ACCOUNT_ID);
  const gatewayId = encodeURIComponent(env.AI_GATEWAY_ID);
  return {
    baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`,
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
    },
  };
}

export function hasOpenAiGateway(env: Env): boolean {
  return gatewayConfig(env) !== null;
}

function requireGateway(env: Env): GatewayConfig {
  const config = gatewayConfig(env);
  if (!config) {
    throw new Error(
      "OpenAI via Cloudflare AI Gateway is not configured; set AI_GATEWAY_ACCOUNT_ID, AI_GATEWAY_ID, AI_GATEWAY_TOKEN, and OPENAI_API_KEY",
    );
  }
  return config;
}

async function gatewayRequest<T>(
  env: Env,
  endpoint: string,
  body: BodyInit,
  contentType?: string,
): Promise<T> {
  const config = requireGateway(env);
  const response = await fetch(`${config.baseUrl}/${endpoint}`, {
    method: "POST",
    headers: {
      ...config.headers,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Cloudflare AI Gateway request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return response.json<T>();
}

async function chatCompletion(env: Env, body: object): Promise<string> {
  const result = await gatewayRequest<ChatCompletion>(
    env,
    "chat/completions",
    JSON.stringify(body),
    "application/json",
  );
  return (result.choices?.[0]?.message?.content ?? "").trim();
}

export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export async function transcribeAudio(
  env: Env,
  bytes: ArrayBuffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  if (bytes.byteLength > MAX_TRANSCRIPTION_BYTES) {
    throw new Error("OpenAI audio transcription accepts files up to 25 MB");
  }

  const form = new FormData();
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("file", new Blob([bytes], { type: contentType }), fileName);
  const result = await gatewayRequest<Transcription>(
    env,
    "audio/transcriptions",
    form,
  );
  return (result.text ?? "").trim();
}

export async function describeImage(
  env: Env,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  return chatCompletion(env, {
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Describe this image faithfully for use as context in a personal note. Include visible people, places, text, objects, and events. Do not speculate.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe the attached image." },
          {
            type: "image_url",
            image_url: {
              url: `data:${contentType};base64,${encodeBase64(bytes)}`,
              detail: "low",
            },
          },
        ],
      },
    ],
    max_completion_tokens: 800,
  });
}

/**
 * Cloudflare's markdown conversion handles PDF, Office documents and plain text
 * uniformly, so a note can carry a contract or a scanned receipt and still
 * contribute text to the extraction step.
 */
export async function documentToText(
  env: Env,
  fileName: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
  if (contentType.startsWith("text/") || contentType === "application/json") {
    return new TextDecoder().decode(bytes).slice(0, 20_000);
  }
  if (!env.AI?.toMarkdown) return "";
  const [converted] = await env.AI.toMarkdown([
    { name: fileName, blob: new Blob([bytes], { type: contentType }) },
  ]);
  if (!converted || converted.format === "error") return "";
  return converted.data.slice(0, 20_000);
}

/* -------------------------------------------------------------------------- */
/*                            Structured extraction                           */
/* -------------------------------------------------------------------------- */

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mention: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name"],
      },
    },
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "string" },
          latitude: { type: "number" },
          longitude: { type: "number" },
          mention: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name"],
      },
    },
    times: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          startsAt: { type: "string" },
          endsAt: { type: "string" },
          allDay: { type: "boolean" },
          recurrence: { type: "string" },
          mention: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["label"],
      },
    },
    organizations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mention: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name"],
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["name"],
      },
    },
  },
  required: ["people", "places", "times", "organizations", "topics"],
} as const;

const EMPTY_EXTRACTION: Extraction = {
  title: null,
  summary: null,
  people: [],
  places: [],
  times: [],
  organizations: [],
  topics: [],
};

function systemPrompt(nowIso: string): string {
  return [
    "You extract structured memory metadata from a personal note.",
    "Return JSON only, no prose, no markdown fences.",
    `The note was captured at ${nowIso}; resolve relative dates such as "tomorrow" or "next friday" against that instant and emit ISO 8601 in startsAt/endsAt.`,
    "people: real individuals referred to by name or by an unambiguous role such as 'my dentist'.",
    "places: physical locations. Only fill latitude/longitude when you are confident of well known coordinates; otherwise omit them.",
    "times: dates, times, deadlines or recurring schedules the note is anchored to. 'label' is a short human phrase like 'Dentist appointment'.",
    "organizations: companies, teams, institutions.",
    "topics: 1 to 5 short thematic tags, lowercase.",
    "confidence is 0..1 and reflects how certain the mention is. Never invent entities that are not supported by the text.",
    "title: a short (max 8 words) title for the note. summary: one or two sentences.",
  ].join("\n");
}

function parseJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function extractStructure(
  env: Env,
  compositeText: string,
  capturedAt: string,
): Promise<Extraction> {
  requireGateway(env);
  const text = compositeText.trim();
  if (text.length === 0) return EMPTY_EXTRACTION;

  const content = await chatCompletion(env, {
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: systemPrompt(capturedAt) },
      { role: "user", content: text.slice(0, 12_000) },
    ],
    max_completion_tokens: 1_400,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "note_extraction",
        schema: EXTRACTION_JSON_SCHEMA,
      },
    },
  });

  const payload = parseJson(content);

  const parsed = extractionSchema.safeParse(payload);
  return parsed.success ? parsed.data : EMPTY_EXTRACTION;
}
