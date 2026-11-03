import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import { assertTwoFactorSatisfied } from "@lictory/core/domain/two-factor-policy";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import type { ConvertedDocument } from "@lictory/core/intelligence/convert";
import {
  MAX_CONTEXT_ENTRIES_PER_SCOPE,
  contextContent,
  contextTitle,
  type ContextEntrySummary,
  type ContextTarget,
  type ContextVersionSummary,
} from "@lictory/core/intelligence/shared";

type Database = PostgresJsDatabase<typeof s>;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Entry = typeof s.intelligenceContextEntry.$inferSelect;
type Version = typeof s.intelligenceContextVersion.$inferSelect;

export class ContextError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413 | 422,
  ) {
    super(message);
  }
}

// Reading is a membership right: everyone can see what steers Lictory
// Intelligence. Organization administrators change organization context;
// project administrators change their project's and its teams' context.
async function membership(
  db: Database | Tx,
  organizationId: string,
  userId: string,
) {
  const [row] = await db
    .select({ role: s.member.role })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
      ),
    );
  if (!row)
    throw new ContextError("You are not a member of this organization.", 403);
  await assertTwoFactorSatisfied(db, userId, organizationId);
  return applicationRoleOf(row.role);
}
export async function canManageIntelligenceContext(
  db: Database | Tx,
  organizationId: string,
  userId: string,
) {
  return (await membership(db, organizationId, userId)) === "admin";
}
// Projects this person administers (active projects only).
async function managedProjectIds(
  db: Database | Tx,
  organizationId: string,
  userId: string,
) {
  const rows = await db
    .select({ projectId: s.projectMember.projectId })
    .from(s.projectMember)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.projectMember.organizationId),
        eq(s.project.id, s.projectMember.projectId),
      ),
    )
    .where(
      and(
        eq(s.projectMember.organizationId, organizationId),
        eq(s.projectMember.userId, userId),
        eq(s.projectMember.role, "admin"),
        isNull(s.project.archivedAt),
      ),
    );
  return rows.map((r) => r.projectId);
}
async function requireManage(
  tx: Tx,
  organizationId: string,
  userId: string,
  placement: Pick<Entry, "scope" | "projectId" | "teamId">,
) {
  if (await canManageIntelligenceContext(tx, organizationId, userId)) return;
  let projectId = placement.scope === "project" ? placement.projectId : null;
  if (placement.scope === "team" && placement.teamId) {
    const [team] = await tx
      .select({ projectId: s.team.projectId })
      .from(s.team)
      .where(
        and(
          eq(s.team.organizationId, organizationId),
          eq(s.team.id, placement.teamId),
        ),
      );
    projectId = team?.projectId ?? null;
  }
  if (
    !projectId ||
    !(await managedProjectIds(tx, organizationId, userId)).includes(projectId)
  )
    throw new ContextError(
      placement.scope === "organization"
        ? "Only organization administrators can change organization Lictory Intelligence Context."
        : "Only this project's administrators can change its Lictory Intelligence Context.",
      403,
    );
}

// Serializes context writes with every other organization write.
async function lock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
}

function versionSummary(v: Version): ContextVersionSummary {
  return {
    id: v.id,
    number: v.number,
    title: v.title,
    content: v.content,
    authorId: v.authorId,
    createdAt: v.createdAt.toISOString(),
    source:
      v.sourceFilename && v.sourceFormat && v.sourceSize !== null
        ? {
            filename: v.sourceFilename,
            format: v.sourceFormat,
            size: v.sourceSize,
          }
        : null,
  };
}

async function latestVersions(
  db: Database | Tx,
  organizationId: string,
  ids: string[],
) {
  const map = new Map<string, { latest: Version; count: number }>();
  if (!ids.length) return map;
  const rows = await db
    .select()
    .from(s.intelligenceContextVersion)
    .where(
      and(
        eq(s.intelligenceContextVersion.organizationId, organizationId),
        inArray(s.intelligenceContextVersion.entryId, ids),
      ),
    )
    .orderBy(desc(s.intelligenceContextVersion.number));
  for (const r of rows) {
    const known = map.get(r.entryId);
    if (known) known.count++;
    else map.set(r.entryId, { latest: r, count: 1 });
  }
  return map;
}

function entrySummary(
  e: Entry,
  versions: Map<string, { latest: Version; count: number }>,
): ContextEntrySummary | undefined {
  const v = versions.get(e.id);
  if (!v) return undefined;
  return {
    id: e.id,
    scope: e.scope,
    projectId: e.projectId,
    teamId: e.teamId,
    kind: e.kind,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    archivedAt: e.archivedAt?.toISOString() ?? null,
    current: versionSummary(v.latest),
    versions: v.count,
  };
}

export async function listIntelligenceContext(
  db: Database,
  organizationId: string,
  userId: string,
) {
  const role = await membership(db, organizationId, userId);
  const entries = await db
    .select()
    .from(s.intelligenceContextEntry)
    .where(eq(s.intelligenceContextEntry.organizationId, organizationId))
    .orderBy(asc(s.intelligenceContextEntry.createdAt));
  const versions = await latestVersions(
    db,
    organizationId,
    entries.map((e) => e.id),
  );
  return {
    canManage: role === "admin",
    // Projects whose (and whose teams') context this person may change.
    manageableProjectIds:
      role === "admin"
        ? []
        : await managedProjectIds(db, organizationId, userId),
    entries: entries
      .map((e) => entrySummary(e, versions))
      .filter((e): e is ContextEntrySummary => Boolean(e)),
  };
}

export async function intelligenceContextHistory(
  db: Database,
  organizationId: string,
  userId: string,
  entryId: string,
) {
  await membership(db, organizationId, userId);
  const entry = await entryOf(db, organizationId, entryId);
  const rows = await db
    .select()
    .from(s.intelligenceContextVersion)
    .where(
      and(
        eq(s.intelligenceContextVersion.organizationId, organizationId),
        eq(s.intelligenceContextVersion.entryId, entry.id),
      ),
    )
    .orderBy(desc(s.intelligenceContextVersion.number));
  return rows.map(versionSummary);
}

async function entryOf(
  db: Database | Tx,
  organizationId: string,
  entryId: string,
) {
  const [entry] = await db
    .select()
    .from(s.intelligenceContextEntry)
    .where(
      and(
        eq(s.intelligenceContextEntry.organizationId, organizationId),
        eq(s.intelligenceContextEntry.id, entryId),
      ),
    );
  if (!entry)
    throw new ContextError("This context entry no longer exists.", 404);
  return entry;
}

// Project and team identifiers come from the client: they must belong to the
// authenticated organization and still be active.
async function checkTarget(
  tx: Tx,
  organizationId: string,
  target: ContextTarget,
) {
  if (target.scope === "project") {
    const [p] = await tx
      .select({ archivedAt: s.project.archivedAt })
      .from(s.project)
      .where(
        and(
          eq(s.project.organizationId, organizationId),
          eq(s.project.id, target.projectId),
        ),
      );
    if (!p || p.archivedAt)
      throw new ContextError("This project no longer exists.", 404);
  }
  if (target.scope === "team") {
    const [t] = await tx
      .select({ archivedAt: s.team.archivedAt })
      .from(s.team)
      .where(
        and(
          eq(s.team.organizationId, organizationId),
          eq(s.team.id, target.teamId),
        ),
      );
    if (!t || t.archivedAt)
      throw new ContextError("This team no longer exists.", 404);
  }
}

async function requireRoom(
  tx: Tx,
  organizationId: string,
  entry: Pick<Entry, "scope" | "projectId" | "teamId">,
) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(s.intelligenceContextEntry)
    .where(
      and(
        eq(s.intelligenceContextEntry.organizationId, organizationId),
        eq(s.intelligenceContextEntry.scope, entry.scope),
        entry.projectId
          ? eq(s.intelligenceContextEntry.projectId, entry.projectId)
          : isNull(s.intelligenceContextEntry.projectId),
        entry.teamId
          ? eq(s.intelligenceContextEntry.teamId, entry.teamId)
          : isNull(s.intelligenceContextEntry.teamId),
        isNull(s.intelligenceContextEntry.archivedAt),
      ),
    );
  if ((row?.count ?? 0) >= MAX_CONTEXT_ENTRIES_PER_SCOPE)
    throw new ContextError(
      `A scope can have at most ${MAX_CONTEXT_ENTRIES_PER_SCOPE} active entries. Archive one first.`,
      409,
    );
}

export type ContextInput = {
  title: string;
  // Written Markdown; for documents, an edit of the converted text.
  content?: string;
  // An uploaded document, already converted.
  document?: ConvertedDocument & { filename: string };
};

function parseInput(input: ContextInput) {
  const title = contextTitle.safeParse(input.title);
  if (!title.success)
    throw new ContextError(title.error.issues[0]!.message, 422);
  const raw = input.document?.markdown ?? input.content;
  if (raw === undefined) return { title: title.data, content: undefined };
  const content = contextContent.safeParse(raw);
  if (!content.success)
    throw new ContextError(content.error.issues[0]!.message, 422);
  return { title: title.data, content: content.data.trim() };
}

function sourceOf(document: ContextInput["document"]) {
  return document
    ? {
        sourceFilename: document.filename,
        sourceFormat: document.format,
        sourceSize: document.size,
        sourceSha256: document.sha256,
      }
    : {};
}

export async function createIntelligenceContext(
  db: Database,
  organizationId: string,
  userId: string,
  target: ContextTarget,
  input: ContextInput,
  idempotencyKey?: string,
) {
  const parsed = parseInput(input);
  if (parsed.content === undefined)
    throw new ContextError("The entry has no content.", 422);
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const placement = {
      scope: target.scope,
      projectId: target.scope === "project" ? target.projectId : null,
      teamId: target.scope === "team" ? target.teamId : null,
    };
    await requireManage(tx, organizationId, userId, placement);
    await checkTarget(tx, organizationId, target);
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(s.intelligenceContextEntry)
        .where(
          and(
            eq(s.intelligenceContextEntry.organizationId, organizationId),
            eq(s.intelligenceContextEntry.createdById, userId),
            eq(s.intelligenceContextEntry.idempotencyKey, idempotencyKey),
          ),
        );
      if (existing) {
        if (
          existing.scope !== placement.scope ||
          existing.projectId !== placement.projectId ||
          existing.teamId !== placement.teamId
        )
          throw new ContextError(
            "Idempotency key was already used for a different context target.",
            409,
          );
        await requireManage(tx, organizationId, userId, existing);
        return { id: existing.id };
      }
    }
    await requireRoom(tx, organizationId, placement);
    const id = crypto.randomUUID();
    await tx.insert(s.intelligenceContextEntry).values({
      id,
      organizationId,
      ...placement,
      kind: input.document ? "document" : "note",
      createdById: userId,
      idempotencyKey: idempotencyKey ?? null,
    });
    await tx.insert(s.intelligenceContextVersion).values({
      organizationId,
      entryId: id,
      number: 1,
      title: parsed.title,
      content: parsed.content,
      authorId: userId,
      ...sourceOf(input.document),
    });
    return { id };
  });
}

// Every change is a new version. The previous one stays readable, so anyone
// can see what Lictory Intelligence was told before.
export async function reviseIntelligenceContext(
  db: Database,
  organizationId: string,
  userId: string,
  entryId: string,
  input: ContextInput,
  idempotencyKey?: string,
) {
  const parsed = parseInput(input);
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const entry = await entryOf(tx, organizationId, entryId);
    await requireManage(tx, organizationId, userId, entry);
    if (idempotencyKey) {
      const [existing] = await tx
        .select({
          id: s.intelligenceContextVersion.id,
          entryId: s.intelligenceContextVersion.entryId,
          number: s.intelligenceContextVersion.number,
        })
        .from(s.intelligenceContextVersion)
        .where(
          and(
            eq(s.intelligenceContextVersion.organizationId, organizationId),
            eq(s.intelligenceContextVersion.authorId, userId),
            eq(s.intelligenceContextVersion.idempotencyKey, idempotencyKey),
          ),
        );
      if (existing) {
        if (existing.entryId !== entryId)
          throw new ContextError(
            "Idempotency key was already used for a different entry.",
            409,
          );
        return {
          id: existing.entryId,
          versionId: existing.id,
          number: existing.number,
        };
      }
    }
    if (entry.archivedAt)
      throw new ContextError("Restore this entry before changing it.", 409);
    if (input.document && entry.kind !== "document")
      throw new ContextError(
        "Only document entries can be replaced by a file.",
        422,
      );
    const latest = (await latestVersions(tx, organizationId, [entry.id])).get(
      entry.id,
    )!.latest;
    const content = parsed.content ?? latest.content;
    if (
      !input.document &&
      parsed.title === latest.title &&
      content === latest.content
    )
      throw new ContextError("There are no changes to save.", 409);
    // An edited document keeps naming the file it came from.
    const source = input.document
      ? sourceOf(input.document)
      : {
          sourceFilename: latest.sourceFilename,
          sourceFormat: latest.sourceFormat,
          sourceSize: latest.sourceSize,
          sourceSha256: latest.sourceSha256,
        };
    const [version] = await tx
      .insert(s.intelligenceContextVersion)
      .values({
        organizationId,
        entryId: entry.id,
        number: latest.number + 1,
        title: parsed.title,
        content,
        authorId: userId,
        idempotencyKey: idempotencyKey ?? null,
        ...source,
      })
      .returning({ id: s.intelligenceContextVersion.id });
    await tx
      .update(s.intelligenceContextEntry)
      .set({ updatedAt: new Date() })
      .where(eq(s.intelligenceContextEntry.id, entry.id));
    return { id: entry.id, versionId: version!.id, number: latest.number + 1 };
  });
}

// Archived entries stop reaching Lictory Intelligence immediately; restoring
// brings the same entry back with its history.
export async function setIntelligenceContextArchived(
  db: Database,
  organizationId: string,
  userId: string,
  entryId: string,
  archived: boolean,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const entry = await entryOf(tx, organizationId, entryId);
    await requireManage(tx, organizationId, userId, entry);
    if (Boolean(entry.archivedAt) === archived) return { id: entry.id };
    if (!archived) {
      await checkTarget(
        tx,
        organizationId,
        entry.scope === "organization"
          ? { scope: "organization" }
          : entry.scope === "project"
            ? { scope: "project", projectId: entry.projectId! }
            : { scope: "team", teamId: entry.teamId! },
      );
      await requireRoom(tx, organizationId, entry);
    }
    await tx
      .update(s.intelligenceContextEntry)
      .set(
        archived
          ? { archivedAt: new Date(), archivedById: userId }
          : { archivedAt: null, archivedById: null },
      )
      .where(eq(s.intelligenceContextEntry.id, entry.id));
    return { id: entry.id };
  });
}
