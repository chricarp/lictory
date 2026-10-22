import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { refreshDirectoryProjection } from "@lictory/core/domain/projections";
import { checkLogo, type LogoKind } from "@lictory/core/branding/logo";

type Database = PostgresJsDatabase<typeof s>;

export class LogoError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 413 | 415,
  ) {
    super(message);
  }
}

async function membership(
  db: Database,
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
  if (!row) throw new LogoError("Organization access has been removed.", 403);
  return applicationRoleOf(row.role);
}

async function requireAdmin(
  db: Database,
  organizationId: string,
  userId: string,
) {
  if ((await membership(db, organizationId, userId)) !== "admin")
    throw new LogoError(
      "Only organization administrators can change the logo.",
      403,
    );
}

// Any member can see their organization's branding.
export async function readLogo(
  db: Database,
  organizationId: string,
  userId: string,
  kind: LogoKind,
) {
  await membership(db, organizationId, userId);
  const [logo] = await db
    .select({
      content: s.organizationLogo.content,
      mimeType: s.organizationLogo.mimeType,
      sha256: s.organizationLogo.sha256,
    })
    .from(s.organizationLogo)
    .where(
      and(
        eq(s.organizationLogo.organizationId, organizationId),
        eq(s.organizationLogo.kind, kind),
      ),
    );
  if (!logo) throw new LogoError("No logo uploaded.", 404);
  return logo;
}

export async function setLogo(
  db: Database,
  organizationId: string,
  userId: string,
  kind: LogoKind,
  bytes: Uint8Array,
) {
  await requireAdmin(db, organizationId, userId);
  const checked = checkLogo(bytes);
  if (!checked.ok) throw new LogoError(checked.error, checked.status);
  const content = Buffer.from(bytes);
  const sha256 = createHash("sha256").update(content).digest("hex");
  const values = {
    organizationId,
    kind,
    content,
    mimeType: checked.mimeType,
    sha256,
    updatedById: userId,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx
      .insert(s.organizationLogo)
      .values(values)
      .onConflictDoUpdate({
        target: [s.organizationLogo.organizationId, s.organizationLogo.kind],
        set: {
          content,
          mimeType: values.mimeType,
          sha256,
          updatedById: userId,
          updatedAt: sql`now()`,
        },
      });
    await refreshDirectoryProjection(tx, organizationId);
  });
  return { sha256 };
}

// Removing is the inverse of uploading; the organization falls back to its
// initial.
export async function removeLogo(
  db: Database,
  organizationId: string,
  userId: string,
  kind: LogoKind,
) {
  await requireAdmin(db, organizationId, userId);
  await db.transaction(async (tx) => {
    await tx
      .delete(s.organizationLogo)
      .where(
        and(
          eq(s.organizationLogo.organizationId, organizationId),
          eq(s.organizationLogo.kind, kind),
        ),
      );
    await refreshDirectoryProjection(tx, organizationId);
  });
}
