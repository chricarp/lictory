import { z } from "zod";
import { convertDocument } from "../intelligence/convert";
import {
  ContextError,
  canManageIntelligenceContext,
  createIntelligenceContext,
  intelligenceContextHistory,
  listIntelligenceContext,
  reviseIntelligenceContext,
  setIntelligenceContextArchived,
  type ContextInput,
} from "../intelligence/server";
import {
  MAX_CONTEXT_DOCUMENT_SIZE,
  contextTarget,
} from "../intelligence/shared";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
  type CapabilityContext,
} from "./core";

// Lictory Intelligence Context: organization knowledge that steers Lictory
// AI. Every member can read it; administrators change it.

const file = z
  .object({
    filename: z.string().min(1).max(255),
    contentBase64: z
      .string()
      .max(Math.ceil((MAX_CONTEXT_DOCUMENT_SIZE * 4) / 3) + 4)
      .describe("The document's bytes, base64-encoded."),
  })
  .describe(
    "A document (PDF, Word, Markdown, text…) converted to Markdown on the server. Replaces `content`.",
  );
const body = {
  title: z.string().max(200),
  content: z.string().optional().describe("Markdown note content."),
  file: file.optional(),
};

async function contextInput(
  ctx: CapabilityContext,
  organizationId: string,
  input: { title: string; content?: string; file?: z.infer<typeof file> },
): Promise<ContextInput> {
  // Reject before converting anything a non-administrator sent.
  if (
    !(await canManageIntelligenceContext(
      ctx.db,
      organizationId,
      ctx.principal.userId,
    ))
  )
    throw new ContextError(
      "Only organization administrators can change Lictory Intelligence Context.",
      403,
    );
  if (!input.file) return { title: input.title, content: input.content };
  const bytes = Uint8Array.from(
    Buffer.from(input.file.contentBase64, "base64"),
  );
  const document = await convertDocument(input.file.filename, bytes);
  return {
    title: input.title,
    document: { ...document, filename: input.file.filename },
  };
}

const listContext = defineCapability({
  name: "listIntelligenceContext",
  title: "List intelligence context",
  description:
    "Organization, project and team knowledge entries that Lictory AI receives, with their current version.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    listIntelligenceContext(ctx.db, input.organizationId, ctx.principal.userId),
});

const contextHistory = defineCapability({
  name: "getIntelligenceContextHistory",
  title: "Get intelligence context history",
  description: "Every version of one context entry, newest first.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, entryId: id }),
  run: async (ctx, input) => ({
    versions: await intelligenceContextHistory(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.entryId,
    ),
  }),
});

const createContext = defineCapability({
  name: "createIntelligenceContext",
  title: "Add intelligence context",
  description:
    "Administrators: add a note (Markdown `content`) or a document (`file`) at organization, project or team scope.",
  kind: "command",
  surfaces: everywhere,
  input: z.object({ organizationId, target: contextTarget, ...body }),
  async run(ctx, input) {
    return createIntelligenceContext(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.target,
      await contextInput(ctx, input.organizationId, input),
    );
  },
});

const reviseContext = defineCapability({
  name: "reviseIntelligenceContext",
  title: "Revise intelligence context",
  description:
    "Administrators: save a new version of an entry. Earlier versions are kept.",
  kind: "command",
  surfaces: everywhere,
  input: z.object({ organizationId, entryId: id, ...body }),
  async run(ctx, input) {
    return reviseIntelligenceContext(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.entryId,
      await contextInput(ctx, input.organizationId, input),
    );
  },
});

const archiveContext = defineCapability({
  name: "archiveIntelligenceContext",
  title: "Archive intelligence context",
  description:
    "Administrators: archive (true) or restore (false) an entry. Archived entries no longer reach Lictory AI.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, entryId: id, archived: z.boolean() }),
  run: (ctx, input) =>
    setIntelligenceContextArchived(
      ctx.db,
      input.organizationId,
      ctx.principal.userId,
      input.entryId,
      input.archived,
    ),
});

export const intelligenceCapabilities = [
  listContext,
  contextHistory,
  createContext,
  reviseContext,
  archiveContext,
] as AnyCapability[];
