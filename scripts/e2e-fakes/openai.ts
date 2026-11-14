// A scripted model behind OpenAI's Responses API, for browser workflows of
// Lictory Intelligence (tests/platform/*.ai.spec.ts). The API and worker reach
// it through the AI SDK's own OPENAI_BASE_URL setting, which scripts/test-e2e.ts
// sets only for those workflows; nothing in the application knows it exists.
//
// It is deliberately small and honest. It decides what a model would do from
// the request alone (the person's words, the page context the server wrote and
// the tool results the server returned), and it only ever learns what the
// server sends: tools still run in the worker with the person's permissions,
// citations are rendered from those real tool results, and a source the
// person cannot read never reaches it. It records every request so a test can
// prove what was (not) sent to the provider. A request it has no script for
// fails with a provider error instead of inventing an answer.
//
// Scripts:
// - "Which work items does this page mention?" reads the page in the context
//   with getPage and lists the work items its Markdown references, linking
//   the page version and the items by their app addresses.
// - A question quoting a phrase ("…" or "...") searches with
//   searchProductKnowledge, reads the first page found with getPage, and
//   quotes the sentence holding the phrase, or says nothing readable matched.
// - Structured output "title" names the conversation; "proposal_intake"
//   drafts one proposal per sentence of the first source, citing it verbatim.
// - The administrator's connection check (ai/check.ts): an "item_review" of
//   its synthetic item DEMO-1, a lookupWorkItem tool call, and an answer
//   after the tool result.
// - Dictation clips (/v1/audio/transcriptions) always transcribe to the same
//   sentence.
import type { ServerResponse } from "node:http";
import { json, listen, send } from "./http";

type Item = {
  type?: string;
  role?: string;
  content?: unknown;
  name?: string;
  arguments?: string;
  call_id?: string;
  output?: unknown;
};
type Body = {
  model?: string;
  input?: Item[];
  instructions?: string;
  stream?: boolean;
  text?: { format?: { type?: string; name?: string } };
};
type Call = { name: string; args: Record<string, unknown>; output: unknown };
type Step =
  | { kind: "call"; name: string; args: Record<string, unknown> }
  | { kind: "text"; text: string };

const partsOf = (content: unknown): string[] =>
  typeof content === "string"
    ? [content]
    : Array.isArray(content)
      ? content.map((part: { text?: unknown }) =>
          typeof part?.text === "string" ? part.text : "",
        )
      : [];
const textOf = (content: unknown) => partsOf(content).join("\n");
// The page context the server wrote beside the person's words
// (contextPrompt in packages/core/src/intelligence/chat/shared.ts).
const isContext = (part: string) => part.startsWith("[Page context:");
const parsed = (value: unknown) =>
  typeof value === "string" ? (json<unknown>(value) ?? value) : value;
const textOr = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const record = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

// The tool result envelope of agentTools: { ok, result } or { ok: false, error }.
function result(call: Call | undefined) {
  const envelope = record(parsed(call?.output));
  return envelope?.ok === true ? record(envelope.result) : undefined;
}
function failure(call: Call | undefined) {
  const envelope = record(parsed(call?.output));
  return envelope?.ok === false
    ? (textOr(record(envelope.error)?.message) ?? "It failed.")
    : undefined;
}

function chatStep(body: Body): Step | null {
  const input = body.input ?? [];
  const last = input.findLastIndex((i) => i.role === "user");
  if (last < 0) return null;
  const parts = partsOf(input[last]!.content);
  const asked = parts.filter((p) => !isContext(p)).join("\n");
  const context = parts.filter(isContext).join("\n");
  const outputs = new Map(
    input
      .slice(last + 1)
      .filter((i) => i.type === "function_call_output")
      .map((i) => [i.call_id, i.output]),
  );
  const calls: Call[] = input
    .slice(last + 1)
    .filter((i) => i.type === "function_call")
    .map((i) => ({
      name: i.name ?? "",
      args: record(json(i.arguments ?? "{}")) ?? {},
      output: outputs.get(i.call_id),
    }));
  const latest = (name: string) => calls.findLast((c) => c.name === name);

  if (asked.includes("lookupWorkItem tool to look up work item DEMO-1")) {
    const lookup = latest("lookupWorkItem");
    if (!lookup)
      return { kind: "call", name: "lookupWorkItem", args: { key: "DEMO-1" } };
    const status = textOr(record(parsed(lookup.output))?.status) ?? "unknown";
    return { kind: "text", text: `DEMO-1 is ${status}.` };
  }

  if (/which work items does this page mention/i.test(asked)) {
    const read = latest("getPage");
    if (!read) {
      const pageId = /pageId ([0-9a-f-]{36})/.exec(context)?.[1];
      const commitId = /commitId ([0-9a-f-]{36})/.exec(context)?.[1];
      if (!pageId) return { kind: "text", text: "Open a page first." };
      return {
        kind: "call",
        name: "getPage",
        args: { pageId, ...(commitId ? { commitId } : {}) },
      };
    }
    const page = result(read);
    if (!page)
      return {
        kind: "text",
        text: `I cannot read that page. ${failure(read) ?? ""}`.trim(),
      };
    const keys = [
      ...new Set(
        [
          ...(textOr(page.markdown) ?? "").matchAll(
            /\[([A-Z][A-Z0-9]*-\d+)\]\(item:[^)]+\)/g,
          ),
        ].map((m) => m[1]!),
      ),
    ];
    // Links as the assistant's instructions ask: the page version and each
    // item by their addresses in the organization the context names.
    const where = /\((\/[^/\s)]+)\/spaces\/([^/\s)?]+)\/pages\//.exec(context);
    const pageRef = record(page.page);
    if (where && pageRef) {
      const [, org, space] = where;
      const href = `${org}/spaces/${space}/pages/${String(pageRef.id)}?commit=${String(page.commitId)}`;
      const items = keys.map((k) => `[${k}](${org}/items/${k})`).join(", ");
      return {
        kind: "text",
        text: keys.length
          ? `Version ${String(page.version)} of [${String(page.title)}](${href}) mentions ${items} (see [the paragraph that cites it](${href})).`
          : `Version ${String(page.version)} of [${String(page.title)}](${href}) mentions no work items.`,
      };
    }
    return {
      kind: "text",
      text: keys.length
        ? `Version ${String(page.version)} of “${String(page.title)}” mentions ${keys.join(", ")}.`
        : `Version ${String(page.version)} of “${String(page.title)}” mentions no work items.`,
    };
  }

  const phrase = /[“"]([^”"]{2,200})[”"]/.exec(asked)?.[1];
  if (phrase) {
    const search = latest("searchProductKnowledge");
    if (!search)
      return {
        kind: "call",
        name: "searchProductKnowledge",
        args: { query: phrase },
      };
    const pages = ((result(search)?.results as unknown[]) ?? [])
      .map(record)
      .filter((r) => r?.kind === "page");
    const first = pages[0];
    const read = latest("getPage");
    if (first && !read)
      return {
        kind: "call",
        name: "getPage",
        args: { pageId: first.pageId, commitId: first.commitId },
      };
    const page = result(read);
    if (!page)
      return {
        kind: "text",
        text: `Nothing you can read mentions “${phrase}”: no page, decision or agreement matched.`,
      };
    const sentence =
      (textOr(page.markdown) ?? "")
        .split(/(?<=[.!?])\s+|\n+/)
        .find((s) => s.toLowerCase().includes(phrase.toLowerCase()))
        ?.trim() ?? "";
    return {
      kind: "text",
      text: `Version ${String(page.version)} of “${String(page.title)}” says: “${sentence}”`,
    };
  }
  return null;
}

// Proposal intake: one draft per sentence of the first source, each citing
// its sentence verbatim (the server checks that).
function intake(prompt: string) {
  const request = record(json(prompt));
  const source = record((request?.sources as unknown[] | undefined)?.[0]);
  const disciplines = (request?.disciplines as { name: string }[]) ?? [];
  if (!source) return null;
  const sentences = String(source.text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    drafts: sentences.map((sentence) => ({
      title: sentence.replace(/[.!?]$/, "").slice(0, 80),
      problem: sentence,
      outcome: null,
      citations: [{ source: String(source.ref), quote: sentence }],
      inferences: [],
      openQuestions: [`What should happen when “${sentence}” does not hold?`],
      reviewers: disciplines.slice(0, 1).map((d) => ({
        discipline: d.name,
        reason: "Owns this behavior.",
      })),
      relatedKnowledge: [],
      contextRefs: [],
    })),
    notes: null,
  };
}

function structured(body: Body) {
  const name = body.text?.format?.name;
  const prompt = (body.input ?? [])
    .filter((i) => i.role === "user")
    .map((i) => textOf(i.content))
    .join("\n");
  if (name === "title")
    return { title: prompt.split(/\s+/).slice(0, 5).join(" ") || "Question" };
  if (name === "proposal_intake") return intake(prompt);
  if (name === "item_review" && prompt.includes("DEMO-1"))
    return {
      summary: "DEMO-1 describes a retry without its failure behavior.",
      strengths: [],
      findings: [],
    };
  return null;
}

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

function stream(response: ServerResponse, model: string, step: Step) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const id = crypto.randomUUID().replaceAll("-", "");
  const event = (data: unknown) =>
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  event({
    type: "response.created",
    response: {
      id: `resp_${id}`,
      created_at: Math.floor(Date.now() / 1000),
      model,
    },
  });
  if (step.kind === "call") {
    const item = {
      type: "function_call",
      id: `fc_${id}`,
      call_id: `call_${id}`,
      name: step.name,
    };
    const args = JSON.stringify(step.args);
    event({
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, arguments: "" },
    });
    event({
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: 0,
      delta: args,
    });
    event({
      type: "response.output_item.done",
      output_index: 0,
      item: { ...item, arguments: args, status: "completed" },
    });
  } else {
    const item = { type: "message", id: `msg_${id}` };
    event({ type: "response.output_item.added", output_index: 0, item });
    event({
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      delta: step.text,
    });
    event({ type: "response.output_item.done", output_index: 0, item });
  }
  event({ type: "response.completed", response: { usage } });
  response.end("data: [DONE]\n\n");
}

export async function startScriptedAi(port: number) {
  const requests: { at: string; body: string }[] = [];
  const unscripted = (response: ServerResponse) =>
    send(response, 400, {
      error: {
        message: "The scripted AI provider has no script for this request.",
        type: "invalid_request_error",
        param: null,
        code: "no_script",
      },
    });
  return listen(port, (request, response) => {
    const path = new URL(request.url, "http://fake").pathname;
    if (request.method === "GET" && path === "/__scripted-ai/requests")
      return send(response, 200, requests);
    // Dictation clips (OpenAI's transcription API): every clip is "heard"
    // as the same sentence, so a test can see dictated words arrive.
    if (request.method === "POST" && path === "/v1/audio/transcriptions") {
      requests.push({ at: new Date().toISOString(), body: "[audio clip]" });
      return send(response, 200, {
        text: "Retry a failed card payment at most three times.",
      });
    }
    if (request.method !== "POST" || path !== "/v1/responses")
      return send(response, 404, { error: { message: "Not found" } });
    requests.push({ at: new Date().toISOString(), body: request.body });
    const body = json<Body>(request.body) ?? {};
    const model = body.model ?? "scripted";
    if (body.text?.format?.type === "json_schema") {
      const output = structured(body);
      if (!output) return unscripted(response);
      const id = crypto.randomUUID().replaceAll("-", "");
      return send(response, 200, {
        id: `resp_${id}`,
        created_at: Math.floor(Date.now() / 1000),
        model,
        output: [
          {
            type: "message",
            role: "assistant",
            id: `msg_${id}`,
            content: [
              {
                type: "output_text",
                text: JSON.stringify(output),
                annotations: [],
              },
            ],
          },
        ],
        usage,
      });
    }
    const step = chatStep(body);
    if (!step) return unscripted(response);
    if (body.stream) return stream(response, model, step);
    // A non-streamed answer (the connection check's answer after a tool result).
    if (step.kind !== "text") return unscripted(response);
    const id = crypto.randomUUID().replaceAll("-", "");
    return send(response, 200, {
      id: `resp_${id}`,
      created_at: Math.floor(Date.now() / 1000),
      model,
      output: [
        {
          type: "message",
          role: "assistant",
          id: `msg_${id}`,
          content: [{ type: "output_text", text: step.text, annotations: [] }],
        },
      ],
      usage,
    });
  });
}
