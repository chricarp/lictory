import { z } from "zod";
import { AnalyzerError } from "@lictory/core/ai/analyzer";
import {
  MAX_INTAKE_CHARACTERS,
  MAX_INTAKE_SOURCES,
  assembleDrafts,
  boundSources,
  createProposalDrafter,
  type IntakeKnowledge,
} from "@lictory/core/ai/intake";
import { capabilitiesOf } from "@lictory/core/contracts/protocol";
import { requireAi } from "@lictory/core/domain/ai";
import { directory } from "@lictory/core/domain/service";
import {
  composeIntelligenceContext,
  promptContext,
} from "@lictory/core/intelligence/compose";
import { convertDocument } from "@lictory/core/intelligence/convert";
import { MAX_CONTEXT_DOCUMENT_SIZE } from "@lictory/core/intelligence/shared";
import {
  CapabilityError,
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import { searchProductKnowledge } from "@lictory/core/capabilities/product-knowledge";

// Proposal intake: rough material in, proposed proposals out. It reads and
// analyses; it never creates work. A person chooses which drafts become
// proposals and creates them with `createWorkItem`, where the draft's
// description carries its verbatim source excerpts. The material is sent to
// the AI provider only when the organization enabled Lictory Intelligence,
// and it is not stored by Lictory.

const KNOWLEDGE_CANDIDATES = 20;
const KNOWLEDGE_EXCERPT = 600;

const source = z
  .object({
    label: z
      .string()
      .trim()
      .max(200)
      .default("")
      .describe(
        "What the material is, e.g. “Customer call, 2 Nov” or “Support ticket 4812”. Shown next to every excerpt cited from it.",
      ),
    text: z
      .string()
      .max(MAX_INTAKE_CHARACTERS)
      .optional()
      .describe("Pasted material: notes, a request, a ticket, an email."),
    file: z
      .object({
        filename: z.string().min(1).max(255),
        contentBase64: z
          .string()
          .max(Math.ceil((MAX_CONTEXT_DOCUMENT_SIZE * 4) / 3) + 4)
          .describe("The document's bytes, base64-encoded."),
      })
      .optional()
      .describe(
        "A document (PDF, Word, PowerPoint, Markdown, text…) converted to text on the server. Images are not supported.",
      ),
  })
  .refine((s) => Boolean(s.text?.trim()) !== Boolean(s.file), {
    message: "Give each source either `text` or a `file`.",
  });

const draftProposals = defineCapability({
  name: "draftProposals",
  title: "Draft proposals from rough material",
  description:
    "Lictory Intelligence reads rough material (meeting notes, customer requests, support tickets, documents) and returns *proposed* proposals for one project: title, problem, expected outcome, open questions, suggested reviewer disciplines and related recorded decisions or approved specifications. Every draft cites verbatim excerpts of the sources and lists what was inferred rather than stated; citations, disciplines and references the server could not verify are removed and counted in `filtered`. Nothing is created. Show the drafts to the person and create only the ones they choose, with createWorkItem (a specification-backed type, the draft's title and its `description`), adjusting them as they ask. Requires Lictory Intelligence to be enabled and permission to edit specifications in the project. The material is sent to the AI provider and not stored.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({
    organizationId,
    projectId: id.describe("Project the proposals are for."),
    sources: z
      .array(source)
      .min(1)
      .max(MAX_INTAKE_SOURCES)
      .describe(
        `Up to ${MAX_INTAKE_SOURCES} pieces of material. At most ${MAX_INTAKE_CHARACTERS.toLocaleString("en-US")} characters are analysed in total; the rest is reported as truncated.`,
      ),
  }),
  async run(ctx, input) {
    const { userId } = ctx.principal;
    const roster = await directory(ctx.db, userId, input.organizationId);
    const project = roster.projects.find(
      (p) => p.id === input.projectId && !p.archivedAt,
    );
    if (!project)
      throw new CapabilityError("not_found", "This project is unavailable.");
    if (
      !capabilitiesOf(roster.disciplines, userId, project.id).editSpecifications
    )
      throw new CapabilityError(
        "forbidden",
        `Your disciplines in ${project.key} cannot create proposals. Ask a project administrator for a discipline that edits specifications.`,
      );
    // Policy first: nothing is converted or read for a disabled organization.
    requireAi(roster.ai);

    const material: { label: string; text: string }[] = [];
    for (const item of input.sources)
      if (item.file) {
        const document = await convertDocument(
          item.file.filename,
          Uint8Array.from(Buffer.from(item.file.contentBase64, "base64")),
        );
        material.push({
          label: item.label || item.file.filename,
          text: document.markdown,
        });
      } else material.push({ label: item.label, text: item.text ?? "" });
    const { sources, truncated } = boundSources(material);
    if (!sources.length)
      throw new CapabilityError("validation", "The material is empty.");

    const [found, composed] = await Promise.all([
      searchProductKnowledge.run(ctx, {
        organizationId: input.organizationId,
        projectId: project.id,
        query: "",
        limit: KNOWLEDGE_CANDIDATES,
      }),
      ctx.db.transaction((tx) =>
        composeIntelligenceContext(tx, input.organizationId, {
          projectId: project.id,
          teamId: null,
        }),
      ),
    ]);
    const knowledge: IntakeKnowledge[] = found.results.map((r, index) => ({
      ref: `K${index + 1}`,
      kind: r.kind,
      id: r.id,
      key: r.key,
      title: r.title,
      revisionId: r.revisionId ?? null,
      revisionNumber: r.revisionNumber ?? null,
      href: r.href,
      excerpt: r.excerpt.slice(0, KNOWLEDGE_EXCERPT),
    }));
    const disciplines = roster.disciplines
      .filter((d) => d.projectId === project.id && !d.archivedAt)
      .map((d) => ({ id: d.id, name: d.name, description: d.description }));

    // The provider call runs outside any transaction; the organization's
    // policy was checked just above, with the person's current access.
    const drafter = ctx.proposalDrafter ?? createProposalDrafter();
    let output;
    try {
      output = await drafter.draft({
        project: { key: project.key, name: project.name },
        sources,
        disciplines,
        knowledge,
        intelligenceContext: promptContext(composed),
      });
    } catch (error) {
      if (error instanceof AnalyzerError)
        throw new CapabilityError("external", error.message, {
          retryable: true,
        });
      throw error;
    }
    const result = assembleDrafts(output, {
      sources,
      disciplines,
      knowledge,
      contextEntries: composed.entries,
    });
    ctx.effects.track("proposals_drafted", {
      organization_id: input.organizationId,
      project_id: project.id,
      surface: ctx.principal.surface,
      source_count: sources.length,
      draft_count: result.drafts.length,
      filtered_drafts: result.filtered.drafts,
      filtered_citations: result.filtered.citations,
    });
    return {
      projectId: project.id,
      model: drafter.model,
      sources: sources.map((s) => ({
        ref: s.ref,
        label: s.label,
        characters: s.text.length,
      })),
      truncated,
      ...result,
    };
  },
});

export const intakeCapabilities = [draftProposals] as AnyCapability[];
