import type { LanguageModel } from "ai";
import { z } from "zod";
import {
  analyzerTarget,
  generateStructured,
  type AnalyzerCall,
} from "@lictory/core/ai/analyzer";
import { proposalIntakeSystem } from "@lictory/core/ai/prompts";

// Proposal intake turns rough material (meeting notes, customer requests,
// support tickets, documents) into *proposed* proposals. Nothing is created:
// the result is shown to a person, who decides which drafts become work items.
// Model output is untrusted: citations must be verbatim excerpts of the
// sources, reviewers must be disciplines of the project and knowledge
// references must be entries the model was given. Anything else is dropped
// and counted, so the person can see what was filtered.

export const MAX_INTAKE_SOURCES = 10;
// Characters of source text sent to the provider per request, across sources.
export const MAX_INTAKE_CHARACTERS = 60_000;
export const MAX_INTAKE_DRAFTS = 10;
const MAX_CITATIONS = 6;
const MAX_QUOTE = 600;
const MAX_TEXT = 2_000;
const MAX_LIST = 8;

// What the model may return. Every field is required (nullable instead of
// optional) so providers with strict structured output accept the schema.
const draftOutput = z.object({
  title: z.string().describe("Short name of the change."),
  problem: z.string().describe("The problem or need, as the sources say it."),
  outcome: z
    .string()
    .nullable()
    .describe("Expected outcome if the sources state it, otherwise null."),
  citations: z
    .array(
      z.object({
        source: z.string().describe("Ref of the source, e.g. S1."),
        quote: z.string().describe("Verbatim excerpt of that source."),
      }),
    )
    .describe("At least one verbatim excerpt supporting the draft."),
  inferences: z
    .array(z.string())
    .describe("Statements the sources imply but do not say."),
  openQuestions: z.array(z.string()),
  reviewers: z.array(
    z.object({
      discipline: z.string().describe("Exact name of a provided discipline."),
      reason: z.string(),
    }),
  ),
  relatedKnowledge: z.array(
    z.object({
      ref: z.string().describe("Ref of a product knowledge entry, e.g. K2."),
      reason: z.string(),
    }),
  ),
  contextRefs: z.array(z.string()),
});
const intakeOutput = z.object({
  drafts: z.array(draftOutput),
  notes: z
    .string()
    .nullable()
    .describe(
      "Material that did not become a draft and why, in one or two sentences, or null.",
    ),
});
export type IntakeOutput = z.infer<typeof intakeOutput>;

export type IntakeSource = { ref: string; label: string; text: string };
export type IntakeKnowledge = {
  ref: string;
  kind: "decision" | "approved" | "delivered";
  id: string;
  key: string;
  title: string;
  revisionId: string | null;
  revisionNumber: number | null;
  href: string;
  excerpt: string;
};
export type IntakeDiscipline = {
  id: string;
  name: string;
  description: string | null;
};
export type IntakeContextEntry = {
  ref: string;
  scope: string;
  scopeName: string;
  title: string;
  content: string;
};

export type IntakeContext = {
  project: { key: string; name: string };
  sources: IntakeSource[];
  disciplines: IntakeDiscipline[];
  knowledge: IntakeKnowledge[];
  intelligenceContext: unknown;
};

// The provider adapter. Tests and failure drills substitute their own.
export type ProposalDrafter = {
  model: string;
  draft(context: IntakeContext, call?: AnalyzerCall): Promise<IntakeOutput>;
};

export function createProposalDrafter(
  options: { model?: LanguageModel; modelId?: string } = {},
): ProposalDrafter {
  const target = analyzerTarget(options);
  return {
    model: target.modelId,
    draft: (context, call) =>
      generateStructured(
        target,
        {
          schema: intakeOutput,
          name: "proposal_intake",
          system: proposalIntakeSystem,
          // The model sees refs and text; ids stay on the server.
          prompt: JSON.stringify({
            project: context.project,
            sources: context.sources,
            disciplines: context.disciplines.map((d) => ({
              name: d.name,
              description: d.description,
            })),
            productKnowledge: context.knowledge.map((k) => ({
              ref: k.ref,
              kind: k.kind,
              key: k.key,
              title: k.title,
              excerpt: k.excerpt,
            })),
            intelligenceContext: context.intelligenceContext,
          }),
        },
        call,
        "Draft the proposals again",
      ),
  };
}

// Bounds the material sent to the provider. Sources are kept in order; the
// one that crosses the budget is clipped and later ones are left out, and
// the result says so instead of silently dropping text.
export function boundSources(
  sources: { label: string; text: string }[],
  budget = MAX_INTAKE_CHARACTERS,
) {
  const kept: IntakeSource[] = [];
  let remaining = budget;
  let truncated = false;
  for (const [index, source] of sources.entries()) {
    const text = source.text.replace(/\r\n?/g, "\n").trim();
    if (!text) continue;
    if (remaining <= 0) {
      truncated = true;
      continue;
    }
    const slice = text.slice(0, remaining);
    if (slice.length < text.length) truncated = true;
    remaining -= slice.length;
    kept.push({
      ref: `S${index + 1}`,
      label: source.label.trim() || `Source ${index + 1}`,
      text: slice,
    });
  }
  return { sources: kept, truncated };
}

// Comparison ignores whitespace layout and typographic quote variants: a
// quote that only reflows lines or swaps ’ for ' is still the source's text.
function normalize(text: string) {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const clip = (text: string, max = MAX_TEXT) => {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};
const list = (items: string[]) =>
  [...new Set(items.map((i) => clip(i, 500)).filter(Boolean))].slice(
    0,
    MAX_LIST,
  );

export type ProposalDraft = {
  title: string;
  problem: string;
  outcome: string | null;
  citations: { source: string; label: string; quote: string }[];
  inferences: string[];
  openQuestions: string[];
  reviewers: { disciplineId: string; name: string; reason: string }[];
  relatedKnowledge: (Omit<IntakeKnowledge, "ref" | "excerpt"> & {
    reason: string;
  })[];
  context: { ref: string; title: string; scope: string }[];
  // Markdown for the new proposal's specification: the draft with its
  // sources quoted, so the evidence stays with the proposal once created.
  description: string;
};

export type IntakeFiltered = {
  // Drafts without a single verifiable excerpt of the sources.
  drafts: number;
  // Excerpts that were not found verbatim in the named source.
  citations: number;
  // Reviewer disciplines that do not exist in the project.
  reviewers: number;
  // Knowledge or context references the model was not given.
  references: number;
};

export function assembleDrafts(
  output: IntakeOutput,
  context: Pick<IntakeContext, "sources" | "disciplines" | "knowledge"> & {
    contextEntries: IntakeContextEntry[];
  },
): { drafts: ProposalDraft[]; filtered: IntakeFiltered; notes: string | null } {
  const filtered: IntakeFiltered = {
    drafts: 0,
    citations: 0,
    reviewers: 0,
    references: 0,
  };
  const sources = new Map(
    context.sources.map((source) => [
      source.ref.toUpperCase(),
      { ...source, normalized: normalize(source.text) },
    ]),
  );
  const disciplines = new Map(
    context.disciplines.map((d) => [d.name.trim().toLowerCase(), d]),
  );
  const knowledge = new Map(
    context.knowledge.map((k) => [k.ref.toUpperCase(), k]),
  );
  const entries = new Map(
    context.contextEntries.map((e) => [e.ref.toUpperCase(), e]),
  );
  const drafts: ProposalDraft[] = [];
  for (const draft of output.drafts) {
    if (drafts.length >= MAX_INTAKE_DRAFTS) {
      filtered.drafts++;
      continue;
    }
    const citations: ProposalDraft["citations"] = [];
    const seenQuotes = new Set<string>();
    for (const citation of draft.citations) {
      const source = sources.get(citation.source.trim().toUpperCase());
      const quote = normalize(citation.quote);
      if (
        !source ||
        !quote ||
        quote.length > MAX_QUOTE ||
        !source.normalized.includes(quote)
      ) {
        filtered.citations++;
        continue;
      }
      if (seenQuotes.has(`${source.ref}\n${quote}`)) continue;
      seenQuotes.add(`${source.ref}\n${quote}`);
      if (citations.length < MAX_CITATIONS)
        citations.push({ source: source.ref, label: source.label, quote });
    }
    const title = clip(draft.title.replace(/\s+/g, " "), 240);
    const problem = clip(draft.problem);
    if (!citations.length || !title || !problem) {
      filtered.drafts++;
      continue;
    }
    const reviewers: ProposalDraft["reviewers"] = [];
    for (const reviewer of draft.reviewers) {
      const discipline = disciplines.get(
        reviewer.discipline.trim().toLowerCase(),
      );
      if (!discipline) {
        filtered.reviewers++;
        continue;
      }
      if (reviewers.some((r) => r.disciplineId === discipline.id)) continue;
      reviewers.push({
        disciplineId: discipline.id,
        name: discipline.name,
        reason: clip(reviewer.reason, 500),
      });
    }
    const relatedKnowledge: ProposalDraft["relatedKnowledge"] = [];
    for (const related of draft.relatedKnowledge) {
      const entry = knowledge.get(related.ref.trim().toUpperCase());
      if (!entry) {
        filtered.references++;
        continue;
      }
      if (relatedKnowledge.some((k) => k.id === entry.id)) continue;
      relatedKnowledge.push({
        kind: entry.kind,
        id: entry.id,
        key: entry.key,
        title: entry.title,
        revisionId: entry.revisionId,
        revisionNumber: entry.revisionNumber,
        href: entry.href,
        reason: clip(related.reason, 500),
      });
    }
    const usedContext: ProposalDraft["context"] = [];
    for (const ref of draft.contextRefs) {
      const entry = entries.get(ref.trim().toUpperCase());
      if (!entry) {
        filtered.references++;
        continue;
      }
      if (usedContext.some((c) => c.ref === entry.ref)) continue;
      usedContext.push({
        ref: entry.ref,
        title: entry.title,
        scope: entry.scope,
      });
    }
    const assembled = {
      title,
      problem,
      outcome: draft.outcome?.trim() ? clip(draft.outcome) : null,
      citations,
      inferences: list(draft.inferences),
      openQuestions: list(draft.openQuestions),
      reviewers,
      relatedKnowledge,
      context: usedContext,
    };
    drafts.push({ ...assembled, description: describeDraft(assembled) });
  }
  return {
    drafts,
    filtered,
    notes: output.notes?.trim() ? clip(output.notes, 1_000) : null,
  };
}

// Deterministic Markdown, not model prose: what was stated, what was inferred
// and the verbatim source excerpts are kept apart so reviewers can tell them
// apart after the proposal is created. Knowledge links use stable item keys.
export function describeDraft(
  draft: Omit<ProposalDraft, "description">,
): string {
  const lines = ["## Problem", "", draft.problem];
  if (draft.outcome) lines.push("", "## Expected outcome", "", draft.outcome);
  if (draft.openQuestions.length)
    lines.push(
      "",
      "## Open questions",
      "",
      ...draft.openQuestions.map((q) => `- ${q}`),
    );
  if (draft.relatedKnowledge.length)
    lines.push(
      "",
      "## Related product knowledge",
      "",
      ...draft.relatedKnowledge.map(
        (k) =>
          `- [${k.key}](${k.href}) ${k.kind === "decision" ? "decision" : `${k.kind} revision ${k.revisionNumber}`} “${k.title}”: ${k.reason}`,
      ),
    );
  lines.push(
    "",
    "## Source material",
    "",
    ...draft.citations.flatMap((c) => [
      `> ${c.quote}`,
      ">",
      `> — ${c.label}`,
      "",
    ]),
  );
  if (draft.inferences.length)
    lines.push(
      "## Inferred, not stated in the sources",
      "",
      ...draft.inferences.map((i) => `- ${i}`),
      "",
    );
  lines.push(
    "_Drafted by Lictory Intelligence from rough material. Confirm or correct it during refinement._",
  );
  return lines.join("\n");
}
