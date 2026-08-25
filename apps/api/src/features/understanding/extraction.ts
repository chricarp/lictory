import { type Extraction, extractionSchema } from "@lictory/contracts";

import type { Env } from "../../bindings";

const TEXT_MODEL = "gpt-5.4-nano";
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

type ChatCompletion = {
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }[];
};

type Transcription = { text?: string };

type OpenAiConfig = {
  baseUrl: string;
  headers: Record<string, string>;
  providerName: string;
};

function openAiConfig(env: Env): OpenAiConfig | null {
  if (!env.OPENAI_API_KEY) return null;

  if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID && env.AI_GATEWAY_TOKEN) {
    const accountId = encodeURIComponent(env.AI_GATEWAY_ACCOUNT_ID);
    const gatewayId = encodeURIComponent(env.AI_GATEWAY_ID);
    return {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
      },
      providerName: "Cloudflare AI Gateway",
    };
  }

  return {
    baseUrl: "https://api.openai.com/v1",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    providerName: "OpenAI",
  };
}

export function hasOpenAiConfiguration(env: Env): boolean {
  return openAiConfig(env) !== null;
}

function requireOpenAi(env: Env): OpenAiConfig {
  const config = openAiConfig(env);
  if (!config) {
    throw new Error("OpenAI is not configured; set OPENAI_API_KEY");
  }
  return config;
}

async function openAiRequest<T>(
  env: Env,
  endpoint: string,
  body: BodyInit,
  contentType?: string,
): Promise<T> {
  const config = requireOpenAi(env);
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
      `${config.providerName} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return response.json<T>();
}

async function chatCompletion(env: Env, body: object): Promise<string> {
  const result = await openAiRequest<ChatCompletion>(
    env,
    "chat/completions",
    JSON.stringify(body),
    "application/json",
  );
  const choice = result.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`OpenAI refused the request: ${choice.message.refusal}`);
  }
  const content = (choice?.message?.content ?? "").trim();
  if (!content) {
    throw new Error(
      `OpenAI returned no content${choice?.finish_reason ? ` (${choice.finish_reason})` : ""}`,
    );
  }
  return content;
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
  const result = await openAiRequest<Transcription>(
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
    reasoning_effort: "none",
    max_completion_tokens: 800,
  });
}

/**
 * AnyDoc converts supported office, OpenDocument, EPUB, CSV and PDF files to
 * Markdown inside the Worker. Text formats stay on the simpler decoder path.
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
  try {
    // Keep the 6 MB WebAssembly parser out of audio/image-only execution and
    // out of unit tests that exercise only the OpenAI adapter.
    const { convertDocumentToMarkdown } = await import("./anydoc");
    return convertDocumentToMarkdown(fileName, bytes).slice(0, 20_000);
  } catch (error) {
    // Workers AI can still recover scanned PDFs that have no extractable text;
    // AnyDoc deliberately does not include OCR.
    if (!env.AI?.toMarkdown) throw error;
    const [converted] = await env.AI.toMarkdown([
      { name: fileName, blob: new Blob([bytes], { type: contentType }) },
    ]);
    if (!converted || converted.format === "error") throw error;
    return converted.data.slice(0, 20_000);
  }
}

/* -------------------------------------------------------------------------- */
/*                            Structured extraction                           */
/* -------------------------------------------------------------------------- */

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    analysis: { type: ["string", "null"] },
    people: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          mention: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
        required: ["name", "description", "mention", "confidence"],
        additionalProperties: false,
      },
    },
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: ["string", "null"] },
          latitude: { type: ["number", "null"] },
          longitude: { type: ["number", "null"] },
          description: { type: ["string", "null"] },
          mention: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
        required: [
          "name",
          "address",
          "latitude",
          "longitude",
          "description",
          "mention",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
    times: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          startsAt: { type: ["string", "null"] },
          endsAt: { type: ["string", "null"] },
          allDay: { type: ["boolean", "null"] },
          timezone: { type: ["string", "null"] },
          recurrence: { type: ["string", "null"] },
          kind: {
            type: "string",
            enum: ["date", "event", "deadline", "reminder"],
          },
          needsReminder: { type: "boolean" },
          reason: { type: ["string", "null"] },
          mention: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
        required: [
          "label",
          "startsAt",
          "endsAt",
          "allDay",
          "timezone",
          "recurrence",
          "kind",
          "needsReminder",
          "reason",
          "mention",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
    organizations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          mention: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
        required: ["name", "description", "mention", "confidence"],
        additionalProperties: false,
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          confidence: { type: ["number", "null"] },
        },
        required: ["name", "description", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title",
    "summary",
    "analysis",
    "people",
    "places",
    "times",
    "organizations",
    "topics",
  ],
  additionalProperties: false,
} as const;

const EMPTY_EXTRACTION: Extraction = {
  title: null,
  summary: null,
  analysis: null,
  people: [],
  places: [],
  times: [],
  organizations: [],
  topics: [],
};

function systemPrompt(nowIso: string, timezone: string): string {
  return [
    "You extract structured memory metadata from a personal note.",
    `The note was captured at ${nowIso} in the IANA timezone ${timezone}. Resolve relative dates such as "tomorrow" or "next Friday" in that timezone and emit ISO 8601 with an offset in startsAt/endsAt.`,
    "people: real individuals referred to by name or by an unambiguous role such as 'my dentist'.",
    "For people, places, organizations and topics, description explains their relevance to this note, not general trivia.",
    "places: physical locations. Only fill latitude/longitude when you are confident of well known coordinates; otherwise use null.",
    "times: every supported date, time, deadline or recurring schedule. kind is date for contextual dates, event for something that happens, deadline for a due time, and reminder only when the note explicitly asks to be reminded.",
    'recurrence describes repetition in plain words and only when the note implies it: "yearly" for a birthday or anniversary, "monthly", "every week", "every other Tuesday". A birthday is a yearly all-day moment — set allDay true, put the known date in startsAt even if the year is in the past, and use kind event. Leave recurrence null for anything that happens once.',
    "Set needsReminder only when the user explicitly requests a reminder or missing the time would clearly cause a required follow-up to be missed. Explain why in reason; otherwise use false and reason may still explain why the date matters.",
    "organizations: companies, teams, institutions.",
    "topics: 1 to 5 short thematic tags, lowercase.",
    "confidence is 0..1 and reflects how certain the mention is. Never invent entities that are not supported by the text.",
    "title: a specific title of at most 8 words. summary: one or two sentences for a feed preview.",
    "analysis: a concise Markdown rundown that states what happened or is being requested, why it matters, decisions or follow-ups, and material uncertainty. Do not repeat the title or pad it with generic observations.",
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
  captureTimezone: string,
): Promise<Extraction> {
  requireOpenAi(env);
  const text = compositeText.trim();
  if (text.length === 0) return EMPTY_EXTRACTION;

  const content = await chatCompletion(env, {
    model: TEXT_MODEL,
    messages: [
      { role: "system", content: systemPrompt(capturedAt, captureTimezone) },
      { role: "user", content: text.slice(0, 12_000) },
    ],
    reasoning_effort: "none",
    max_completion_tokens: 5_000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "note_extraction",
        strict: true,
        schema: EXTRACTION_JSON_SCHEMA,
      },
    },
  });

  const payload = parseJson(content);

  const parsed = extractionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `OpenAI returned an invalid note extraction: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}
