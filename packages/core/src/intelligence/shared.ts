import { z } from "zod";

// Lictory Intelligence Context: what administrators tell Lictory Intelligence
// about the organization, a project or a team. Shared by server, Lictory
// Intelligence and client.

export const contextScopes = ["organization", "project", "team"] as const;
export type ContextScope = (typeof contextScopes)[number];
export const contextKinds = ["note", "document"] as const;
export type ContextKind = (typeof contextKinds)[number];

// Narrower scopes describe more specific situations, so they win on conflict
// and are kept first when the prompt budget runs out.
export const scopePrecedence: ContextScope[] = [
  "team",
  "project",
  "organization",
];

export const MAX_CONTEXT_TITLE = 120;
// One entry may be long (a converted handbook), but a single entry can never
// crowd out every other one.
export const MAX_CONTEXT_CONTENT = 100_000;
// Characters of context sent with one Lictory Intelligence request, across all
// scopes.
export const CONTEXT_PROMPT_BUDGET = 40_000;
export const MAX_CONTEXT_ENTRIES_PER_SCOPE = 50;
// Uploads go through a server function (conversion happens there), whose
// request bodies are limited by the hosting platform (4.5 MB on Vercel).
export const MAX_CONTEXT_DOCUMENT_SIZE = 4 * 1024 * 1024;

// Formats anydoc converts locally, plus Markdown and text used as they are.
export const contextDocumentExtensions = [
  "pdf",
  "doc",
  "docx",
  "docm",
  "odt",
  "rtf",
  "epub",
  "ppt",
  "pps",
  "pot",
  "pptx",
  "pptm",
  "ppsx",
  "ppsm",
  "odp",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "ods",
  "csv",
  "md",
  "markdown",
  "txt",
] as const;
export const ACCEPT_CONTEXT_DOCUMENTS = contextDocumentExtensions
  .map((e) => `.${e}`)
  .join(",");

export const contextTarget = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("organization") }),
  z.object({ scope: z.literal("project"), projectId: z.string().min(1) }),
  z.object({ scope: z.literal("team"), teamId: z.string().min(1) }),
]);
export type ContextTarget = z.infer<typeof contextTarget>;

export const contextTitle = z
  .string()
  .trim()
  .min(1, "Give the entry a title.")
  .max(
    MAX_CONTEXT_TITLE,
    `Titles can be at most ${MAX_CONTEXT_TITLE} characters.`,
  );
export const contextContent = z
  .string()
  .max(
    MAX_CONTEXT_CONTENT,
    `Context entries can be at most ${MAX_CONTEXT_CONTENT.toLocaleString("en-US")} characters.`,
  )
  .refine((v) => v.trim().length > 0, "The entry has no content.");

export type ContextVersionSummary = {
  id: string;
  number: number;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
  source: {
    filename: string;
    format: string;
    size: number;
  } | null;
};

export type ContextEntrySummary = {
  id: string;
  scope: ContextScope;
  projectId: string | null;
  teamId: string | null;
  kind: ContextKind;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
  // The current version: what Lictory Intelligence receives while the entry is
  // active.
  current: ContextVersionSummary;
  versions: number;
};

// Recorded on a Lictory Intelligence run and on each finding that relied on it.
export const intelligenceContextUseSchema = z.object({
  entryId: z.string().max(160),
  versionId: z.string().max(160),
  version: z.number().int(),
  scope: z.enum(contextScopes),
  // The organization, project or team name at the time of the run.
  scopeName: z.string().max(200),
  title: z.string().max(200),
  // Part of the content was left out because the budget was reached.
  truncated: z.boolean().default(false),
});
export type IntelligenceContextUse = z.infer<
  typeof intelligenceContextUseSchema
>;

export const scopeLabel: Record<ContextScope, string> = {
  organization: "Organization",
  project: "Project",
  team: "Team",
};
