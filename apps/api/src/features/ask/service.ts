import type { AskCitation, AskQuery, AskSourceKind } from "@lictory/contracts";

import type { Env } from "../../bindings";
import { askQueryRecord } from "../../infrastructure/database/records";
import type { AskQueryRow } from "../../infrastructure/database/rows";
import {
  answerFromNoteContext,
  hasOpenAiConfiguration,
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

export async function listAskQueries(
  env: Env,
  userId: string,
): Promise<AskQuery[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM ask_queries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(userId)
    .all<AskQueryRow>();
  return result.results.map(askQueryRecord);
}

export async function loadAskQuery(
  env: Env,
  userId: string,
  queryId: string,
): Promise<AskQuery | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM ask_queries WHERE id = ? AND user_id = ?",
  )
    .bind(queryId, userId)
    .first<AskQueryRow>();
  return row ? askQueryRecord(row) : null;
}

export async function createAskQuery(
  env: Env,
  userId: string,
  question: string,
): Promise<AskQuery> {
  const sources = rankNoteCorpus(await loadCorpus(env, userId), question);
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
      );
    } catch (error) {
      console.error("Ask synthesis failed; returning grounded excerpts", error);
    }
  }

  const row: AskQueryRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    question,
    answer_markdown: answerMarkdown,
    citations_json: JSON.stringify(citations),
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare(
    `INSERT INTO ask_queries (id, user_id, question, answer_markdown, citations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.user_id,
      row.question,
      row.answer_markdown,
      row.citations_json,
      row.created_at,
    )
    .run();
  return askQueryRecord(row);
}

export async function deleteAskQuery(
  env: Env,
  userId: string,
  queryId: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "DELETE FROM ask_queries WHERE id = ? AND user_id = ?",
  )
    .bind(queryId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
