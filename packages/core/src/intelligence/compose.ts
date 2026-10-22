import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import {
  CONTEXT_PROMPT_BUDGET,
  scopePrecedence,
  type ContextScope,
  type IntelligenceContextUse,
} from "@lictory/core/intelligence/shared";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// What the model receives: entries ordered from the broadest scope to the
// narrowest, each with a reference findings can cite.
export type PromptContextEntry = {
  ref: string;
  scope: ContextScope;
  scopeName: string;
  title: string;
  content: string;
};
export type ComposedContext = {
  entries: PromptContextEntry[];
  // Ref → what the run used, for citations and the run's audit record.
  uses: Map<string, IntelligenceContextUse>;
  omitted: number;
};

// The smallest useful slice of an entry; below this an entry is left out
// rather than sent as a fragment.
const MIN_SLICE = 500;

// Lictory Intelligence Context for work in a project and team: the
// organization's entries, the project's and the team's. Active entries only,
// at their current version. When the budget runs out, narrower scopes are
// kept first because they describe the reviewed work most specifically.
export async function composeIntelligenceContext(
  tx: Tx,
  organizationId: string,
  target: { projectId: string | null; teamId: string | null },
  budget = CONTEXT_PROMPT_BUDGET,
): Promise<ComposedContext> {
  const scopes = [
    eq(s.intelligenceContextEntry.scope, "organization"),
    target.projectId
      ? and(
          eq(s.intelligenceContextEntry.scope, "project"),
          eq(s.intelligenceContextEntry.projectId, target.projectId),
        )
      : undefined,
    target.teamId
      ? and(
          eq(s.intelligenceContextEntry.scope, "team"),
          eq(s.intelligenceContextEntry.teamId, target.teamId),
        )
      : undefined,
  ].filter(Boolean);
  const entries = await tx
    .select()
    .from(s.intelligenceContextEntry)
    .where(
      and(
        eq(s.intelligenceContextEntry.organizationId, organizationId),
        isNull(s.intelligenceContextEntry.archivedAt),
        or(...scopes),
      ),
    )
    .orderBy(s.intelligenceContextEntry.createdAt);
  if (!entries.length) return { entries: [], uses: new Map(), omitted: 0 };
  const versions = await tx
    .select()
    .from(s.intelligenceContextVersion)
    .where(
      and(
        eq(s.intelligenceContextVersion.organizationId, organizationId),
        inArray(
          s.intelligenceContextVersion.entryId,
          entries.map((e) => e.id),
        ),
      ),
    )
    .orderBy(desc(s.intelligenceContextVersion.number));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const v of versions)
    if (!latest.has(v.entryId)) latest.set(v.entryId, v);
  const [organization] = await tx
    .select({ name: s.organization.name })
    .from(s.organization)
    .where(eq(s.organization.id, organizationId));
  const [project] = target.projectId
    ? await tx
        .select({ name: s.project.name })
        .from(s.project)
        .where(
          and(
            eq(s.project.organizationId, organizationId),
            eq(s.project.id, target.projectId),
          ),
        )
    : [];
  const [team] = target.teamId
    ? await tx
        .select({ name: s.team.name })
        .from(s.team)
        .where(
          and(
            eq(s.team.organizationId, organizationId),
            eq(s.team.id, target.teamId),
          ),
        )
    : [];
  const scopeName: Record<ContextScope, string> = {
    organization: organization?.name ?? "Organization",
    project: project?.name ?? "Project",
    team: team?.name ?? "Team",
  };

  let remaining = budget;
  let omitted = 0;
  const kept = new Map<string, { content: string; truncated: boolean }>();
  for (const scope of scopePrecedence)
    for (const e of entries.filter((x) => x.scope === scope)) {
      const v = latest.get(e.id);
      if (!v) continue;
      if (v.content.length <= remaining) {
        kept.set(e.id, { content: v.content, truncated: false });
        remaining -= v.content.length;
      } else if (remaining >= MIN_SLICE) {
        kept.set(e.id, {
          content: `${v.content.slice(0, remaining)}\n…[truncated]`,
          truncated: true,
        });
        remaining = 0;
      } else omitted++;
    }

  const result: ComposedContext = { entries: [], uses: new Map(), omitted };
  for (const scope of [...scopePrecedence].reverse())
    for (const e of entries.filter((x) => x.scope === scope)) {
      const k = kept.get(e.id);
      const v = latest.get(e.id);
      if (!k || !v) continue;
      const ref = `C${result.entries.length + 1}`;
      result.entries.push({
        ref,
        scope,
        scopeName: scopeName[scope],
        title: v.title,
        content: k.content,
      });
      result.uses.set(ref, {
        entryId: e.id,
        versionId: v.id,
        version: v.number,
        scope,
        scopeName: scopeName[scope].slice(0, 200),
        title: v.title.slice(0, 200),
        truncated: k.truncated,
      });
    }
  return result;
}

// What goes into the model's input next to the reviewed work.
export function promptContext(composed: ComposedContext) {
  return composed.entries.length
    ? {
        precedence: "team overrides project, project overrides organization",
        entries: composed.entries,
        ...(composed.omitted ? { omittedEntries: composed.omitted } : {}),
      }
    : null;
}
