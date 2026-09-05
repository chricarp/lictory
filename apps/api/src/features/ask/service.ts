import type {
  AskCitation,
  AskConversation,
  AskConversationSummary,
  AskSourceKind,
} from "@lictory/contracts";

import type { Env } from "../../bindings";
import {
  askConversationSummaryRecord,
  askMessageRecord,
} from "../../infrastructure/database/records";
import type {
  AskConversationRow,
  AskMessageRow,
} from "../../infrastructure/database/rows";
import {
  answerFromNoteContext,
  hasOpenAiConfiguration,
  synthesizeAskConversationTitle,
} from "../understanding/extraction";

type CorpusRow = {
  id: string;
  title: string | null;
  body_markdown: string;
  ai_summary: string | null;
  ai_analysis: string | null;
  audio_text: string;
  image_text: string;
  document_text: string;
  entity_text: string;
  created_at: string;
};

type CorpusField = {
  kind: AskSourceKind;
  text: string;
  weight: number;
};

export type RankedNote = {
  row: CorpusRow;
  score: number;
  excerpt: string;
  context: string;
  sourceKinds: AskSourceKind[];
};

const STOP_WORDS = new Set([
  "about",
  "also",
  "alla",
  "anche",
  "and",
  "are",
  "chi",
  "cosa",
  "come",
  "con",
  "dalla",
  "dei",
  "del",
  "delle",
  "dello",
  "did",
  "does",
  "dove",
  "ever",
  "for",
  "from",
  "have",
  "how",
  "into",
  "latest",
  "lately",
  "mai",
  "nelle",
  "nella",
  "note",
  "notes",
  "per",
  "quale",
  "quando",
  "recent",
  "recente",
  "recenti",
  "recently",
  "say",
  "said",
  "search",
  "show",
  "something",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "ultima",
  "ultime",
  "ultimi",
  "ultimo",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "wrote",
  "written",
  "would",
  "your",
]);

const RECENCY_INTENT =
  /\b(recent|recently|latest|lately|recente|recenti|ultim[a-z]*)\b/;

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function questionTerms(question: string): string[] {
  return [
    ...new Set(
      normalized(question)
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    ),
  ].slice(0, 12);
}

function termHits(value: string, terms: string[]): number {
  const words = new Set(
    normalized(value)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  return terms.reduce(
    (total, term) =>
      total +
      ([...words].some(
        (word) => word === term || (term.length >= 4 && word.startsWith(term)),
      )
        ? 1
        : 0),
    0,
  );
}

function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptAround(value: string, terms: string[]): string {
  const text = plainText(value);
  if (text.length <= 320) return text;
  const lower = normalized(text);
  const hit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(0, (hit ?? 0) - 90);
  const end = Math.min(text.length, start + 320);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function corpusFields(row: CorpusRow): CorpusField[] {
  return [
    { kind: "body", text: row.title ?? "", weight: 7 },
    { kind: "body", text: row.body_markdown, weight: 5 },
    { kind: "context", text: row.ai_summary ?? "", weight: 4 },
    { kind: "context", text: row.ai_analysis ?? "", weight: 3 },
    { kind: "audio", text: row.audio_text, weight: 5 },
    { kind: "image", text: row.image_text, weight: 5 },
    { kind: "document", text: row.document_text, weight: 5 },
    { kind: "context", text: row.entity_text, weight: 6 },
  ];
}

function readableContext(fields: CorpusField[]): string {
  return fields
    .filter((field) => field.text.trim())
    .map((field) => `[${field.kind}] ${plainText(field.text)}`)
    .join("\n")
    .slice(0, 8_000);
}

/** Pure lexical ranking over every readable surface of a note. */
export function rankNoteCorpus(
  rows: CorpusRow[],
  question: string,
): RankedNote[] {
  const terms = questionTerms(question);
  if (terms.length === 0) {
    if (!RECENCY_INTENT.test(normalized(question))) return [];
    return rows
      .map((row, index): RankedNote | null => {
        const fields = corpusFields(row).filter((field) => field.text.trim());
        const preview =
          fields.find((field) => field.kind === "body") ?? fields[0];
        if (!preview) return null;
        return {
          row,
          score: rows.length - index,
          excerpt: excerptAround(preview.text, []),
          context: readableContext(fields),
          sourceKinds: [...new Set(fields.map((field) => field.kind))],
        };
      })
      .filter((result): result is RankedNote => result !== null)
      .slice(0, 8);
  }

  return rows
    .map((row): RankedNote | null => {
      const fields = corpusFields(row);
      const matched = fields
        .map((field) => ({ ...field, hits: termHits(field.text, terms) }))
        .filter((field) => field.hits > 0);
      if (matched.length === 0) return null;

      const best = [...matched].sort(
        (a, b) => b.hits * b.weight - a.hits * a.weight,
      )[0];
      if (!best) return null;
      const sourceKinds = [...new Set(matched.map((field) => field.kind))];

      return {
        row,
        score: matched.reduce(
          (score, field) => score + field.hits * field.weight,
          0,
        ),
        excerpt: excerptAround(best.text, terms),
        context: readableContext(fields),
        sourceKinds,
      };
    })
    .filter((result): result is RankedNote => result !== null)
    .sort(
      (a, b) =>
        b.score - a.score || b.row.created_at.localeCompare(a.row.created_at),
    )
    .slice(0, 8);
}

function groundedFallback(question: string, sources: RankedNote[]): string {
  if (sources.length === 0) {
    return `I couldn’t find anything in your notes that answers “${question}”. Try asking with a person, place, date, or a phrase you remember.`;
  }

  const passages = sources
    .slice(0, 4)
    .map((source, index) => {
      const title = source.row.title?.trim() || "Untitled note";
      return `- **${title}** — ${source.excerpt} [${index + 1}]`;
    })
    .join("\n");
  return `I found relevant context in ${sources.length} ${sources.length === 1 ? "note" : "notes"}:\n\n${passages}`;
}

async function loadCorpus(env: Env, userId: string): Promise<CorpusRow[]> {
  const result = await env.DB.prepare(
    `SELECT n.id, n.title, n.body_markdown, n.ai_summary, n.ai_analysis, n.created_at,
            COALESCE((SELECT group_concat(m.ai_result, '\n') FROM media_assets m
                       WHERE m.note_id = n.id AND m.kind = 'audio' AND m.ai_result IS NOT NULL), '') AS audio_text,
            COALESCE((SELECT group_concat(m.ai_result, '\n') FROM media_assets m
                       WHERE m.note_id = n.id AND m.kind = 'image' AND m.ai_result IS NOT NULL), '') AS image_text,
            COALESCE((SELECT group_concat(m.ai_result, '\n') FROM media_assets m
                       WHERE m.note_id = n.id AND m.kind = 'document' AND m.ai_result IS NOT NULL), '') AS document_text,
            COALESCE((SELECT group_concat(e.type || ': ' || e.name || ' ' || COALESCE(e.description, '') || ' ' || COALESCE(ne.mention, ''), '\n')
                        FROM note_entities ne JOIN entities e ON e.id = ne.entity_id
                       WHERE ne.note_id = n.id AND ne.status <> 'rejected'), '') AS entity_text
       FROM notes n
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC`,
  )
    .bind(userId)
    .all<CorpusRow>();
  return result.results;
}

export function fallbackConversationTitle(userMessages: string[]): string {
  const firstMessage = plainText(userMessages[0] ?? "New conversation");
  const words = firstMessage.split(/\s+/).filter(Boolean);
  const title = words.slice(0, 7).join(" ");
  return `${title || "New conversation"}${words.length > 7 ? "…" : ""}`.slice(
    0,
    80,
  );
}

async function conversationTitle(
  env: Env,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
  const fallback = fallbackConversationTitle(
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  );
  if (!hasOpenAiConfiguration(env)) return fallback;

  try {
    return (await synthesizeAskConversationTitle(env, messages)) || fallback;
  } catch (error) {
    console.error("Ask title synthesis failed; using the prompt", error);
    return fallback;
  }
}

function conversationRecord(
  row: AskConversationRow,
  messages: AskMessageRow[],
): AskConversation {
  return {
    ...askConversationSummaryRecord(row),
    messages: messages.map(askMessageRecord),
  };
}

async function loadMessageRows(
  env: Env,
  conversationId: string,
): Promise<AskMessageRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM ask_messages WHERE conversation_id = ? ORDER BY position ASC",
  )
    .bind(conversationId)
    .all<AskMessageRow>();
  return result.results;
}

async function createAnswer(
  env: Env,
  userId: string,
  question: string,
  previousMessages: AskMessageRow[],
): Promise<{
  answerMarkdown: string;
  citations: AskCitation[];
  title: string;
}> {
  const recentQuestions = previousMessages
    .filter((message) => message.role === "user")
    .slice(-3)
    .reverse()
    .map((message) => message.content_markdown);
  const retrievalQuestion = [question, ...recentQuestions].join("\n");
  const sources = rankNoteCorpus(
    await loadCorpus(env, userId),
    retrievalQuestion,
  );
  const citations: AskCitation[] = sources.map((source) => ({
    noteId: source.row.id,
    title: source.row.title,
    excerpt: source.excerpt,
    sourceKinds: source.sourceKinds,
  }));

  let answerMarkdown = groundedFallback(question, sources);
  if (sources.length > 0 && hasOpenAiConfiguration(env)) {
    try {
      answerMarkdown = await answerFromNoteContext(
        env,
        question,
        sources.map((source, index) => ({
          index: index + 1,
          title: source.row.title?.trim() || "Untitled note",
          context: source.context,
        })),
        previousMessages.map((message) => ({
          role: message.role,
          content: message.content_markdown,
        })),
      );
    } catch (error) {
      console.error("Ask synthesis failed; returning grounded excerpts", error);
    }
  }

  const title = await conversationTitle(env, [
    ...previousMessages.map((message) => ({
      role: message.role,
      content: message.content_markdown,
    })),
    { role: "user", content: question },
    { role: "assistant", content: answerMarkdown },
  ]);
  return { answerMarkdown, citations, title };
}

export class AskMutationError extends Error {
  constructor(
    readonly code:
      | "conversation_not_found"
      | "message_not_found"
      | "message_not_user"
      | "message_not_assistant",
  ) {
    super(code);
    this.name = "AskMutationError";
  }
}

async function requireConversation(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<{ row: AskConversationRow; messages: AskMessageRow[] }> {
  const row = await env.DB.prepare(
    "SELECT * FROM ask_conversations WHERE id = ? AND user_id = ?",
  )
    .bind(conversationId, userId)
    .first<AskConversationRow>();
  if (!row) throw new AskMutationError("conversation_not_found");
  return { row, messages: await loadMessageRows(env, conversationId) };
}

export async function listAskConversations(
  env: Env,
  userId: string,
): Promise<AskConversationSummary[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM ask_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100",
  )
    .bind(userId)
    .all<AskConversationRow>();
  return result.results.map(askConversationSummaryRecord);
}

export async function loadAskConversation(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<AskConversation | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM ask_conversations WHERE id = ? AND user_id = ?",
  )
    .bind(conversationId, userId)
    .first<AskConversationRow>();
  if (!row) return null;
  return conversationRecord(row, await loadMessageRows(env, conversationId));
}

export async function createAskConversation(
  env: Env,
  userId: string,
  message: string,
): Promise<AskConversation> {
  const generated = await createAnswer(env, userId, message, []);
  const conversationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const row: AskConversationRow = {
    id: conversationId,
    user_id: userId,
    title: generated.title,
    created_at: now,
    updated_at: now,
  };
  const userMessage: AskMessageRow = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role: "user",
    position: 0,
    content_markdown: message,
    citations_json: "[]",
    created_at: now,
    updated_at: now,
  };
  const assistantMessage: AskMessageRow = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role: "assistant",
    position: 1,
    content_markdown: generated.answerMarkdown,
    citations_json: JSON.stringify(generated.citations),
    created_at: now,
    updated_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ask_conversations (id, user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(row.id, row.user_id, row.title, row.created_at, row.updated_at),
    env.DB.prepare(
      `INSERT INTO ask_messages (id, conversation_id, role, position, content_markdown, citations_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userMessage.id,
      userMessage.conversation_id,
      userMessage.role,
      userMessage.position,
      userMessage.content_markdown,
      userMessage.citations_json,
      userMessage.created_at,
      userMessage.updated_at,
    ),
    env.DB.prepare(
      `INSERT INTO ask_messages (id, conversation_id, role, position, content_markdown, citations_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      assistantMessage.id,
      assistantMessage.conversation_id,
      assistantMessage.role,
      assistantMessage.position,
      assistantMessage.content_markdown,
      assistantMessage.citations_json,
      assistantMessage.created_at,
      assistantMessage.updated_at,
    ),
  ]);
  return conversationRecord(row, [userMessage, assistantMessage]);
}

export async function appendAskMessage(
  env: Env,
  userId: string,
  conversationId: string,
  message: string,
): Promise<AskConversation> {
  const current = await requireConversation(env, userId, conversationId);
  const generated = await createAnswer(env, userId, message, current.messages);
  const now = new Date().toISOString();
  const position = (current.messages.at(-1)?.position ?? -1) + 1;
  const userMessage: AskMessageRow = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role: "user",
    position,
    content_markdown: message,
    citations_json: "[]",
    created_at: now,
    updated_at: now,
  };
  const assistantMessage: AskMessageRow = {
    ...userMessage,
    id: crypto.randomUUID(),
    role: "assistant",
    position: position + 1,
    content_markdown: generated.answerMarkdown,
    citations_json: JSON.stringify(generated.citations),
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ask_messages (id, conversation_id, role, position, content_markdown, citations_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userMessage.id,
      conversationId,
      userMessage.role,
      userMessage.position,
      userMessage.content_markdown,
      userMessage.citations_json,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO ask_messages (id, conversation_id, role, position, content_markdown, citations_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      assistantMessage.id,
      conversationId,
      assistantMessage.role,
      assistantMessage.position,
      assistantMessage.content_markdown,
      assistantMessage.citations_json,
      now,
      now,
    ),
    env.DB.prepare(
      "UPDATE ask_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).bind(generated.title, now, conversationId, userId),
  ]);
  return conversationRecord(
    { ...current.row, title: generated.title, updated_at: now },
    [...current.messages, userMessage, assistantMessage],
  );
}

export async function updateAskUserMessage(
  env: Env,
  userId: string,
  conversationId: string,
  messageId: string,
  message: string,
): Promise<AskConversation> {
  const current = await requireConversation(env, userId, conversationId);
  const target = current.messages.find((item) => item.id === messageId);
  if (!target) throw new AskMutationError("message_not_found");
  if (target.role !== "user") throw new AskMutationError("message_not_user");

  const previous = current.messages.filter(
    (item) => item.position < target.position,
  );
  const generated = await createAnswer(env, userId, message, previous);
  const now = new Date().toISOString();
  const updatedUser: AskMessageRow = {
    ...target,
    content_markdown: message,
    citations_json: "[]",
    updated_at: now,
  };
  const assistantMessage: AskMessageRow = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role: "assistant",
    position: target.position + 1,
    content_markdown: generated.answerMarkdown,
    citations_json: JSON.stringify(generated.citations),
    created_at: now,
    updated_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM ask_messages WHERE conversation_id = ? AND position > ?",
    ).bind(conversationId, target.position),
    env.DB.prepare(
      `UPDATE ask_messages SET content_markdown = ?, citations_json = '[]', updated_at = ?
       WHERE id = ? AND conversation_id = ?`,
    ).bind(message, now, messageId, conversationId),
    env.DB.prepare(
      `INSERT INTO ask_messages (id, conversation_id, role, position, content_markdown, citations_json, created_at, updated_at)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
    ).bind(
      assistantMessage.id,
      conversationId,
      assistantMessage.position,
      assistantMessage.content_markdown,
      assistantMessage.citations_json,
      now,
      now,
    ),
    env.DB.prepare(
      "UPDATE ask_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).bind(generated.title, now, conversationId, userId),
  ]);
  return conversationRecord(
    { ...current.row, title: generated.title, updated_at: now },
    [...previous, updatedUser, assistantMessage],
  );
}

export async function regenerateAskMessage(
  env: Env,
  userId: string,
  conversationId: string,
  messageId: string,
): Promise<AskConversation> {
  const current = await requireConversation(env, userId, conversationId);
  const target = current.messages.find((item) => item.id === messageId);
  if (!target) throw new AskMutationError("message_not_found");
  if (target.role !== "assistant") {
    throw new AskMutationError("message_not_assistant");
  }
  const userMessage = current.messages.find(
    (item) => item.position === target.position - 1 && item.role === "user",
  );
  if (!userMessage) throw new AskMutationError("message_not_found");
  const previous = current.messages.filter(
    (item) => item.position < userMessage.position,
  );
  const generated = await createAnswer(
    env,
    userId,
    userMessage.content_markdown,
    previous,
  );
  const now = new Date().toISOString();
  const regenerated: AskMessageRow = {
    ...target,
    content_markdown: generated.answerMarkdown,
    citations_json: JSON.stringify(generated.citations),
    updated_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM ask_messages WHERE conversation_id = ? AND position > ?",
    ).bind(conversationId, target.position),
    env.DB.prepare(
      `UPDATE ask_messages SET content_markdown = ?, citations_json = ?, updated_at = ?
       WHERE id = ? AND conversation_id = ?`,
    ).bind(
      regenerated.content_markdown,
      regenerated.citations_json,
      now,
      messageId,
      conversationId,
    ),
    env.DB.prepare(
      "UPDATE ask_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).bind(generated.title, now, conversationId, userId),
  ]);
  return conversationRecord(
    { ...current.row, title: generated.title, updated_at: now },
    [...previous, userMessage, regenerated],
  );
}

export async function deleteAskConversation(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "DELETE FROM ask_conversations WHERE id = ? AND user_id = ?",
  )
    .bind(conversationId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
