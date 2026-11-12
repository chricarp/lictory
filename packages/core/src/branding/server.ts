import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { refreshDirectoryProjection } from "@lictory/core/domain/projections";
import { lock } from "@lictory/core/domain/service";
import {
  checkLogo,
  imageSize,
  publicLogoPath,
  type LogoKind,
} from "@lictory/core/branding/logo";
import {
  brandPalette,
  normalizeBrandColor,
} from "@lictory/core/branding/color";
import type { EmailBrand } from "@lictory/core/emails/components/auth-email-layout";

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
  if (!row)
    throw new LogoError("You are not a member of this organization.", 403);
  return applicationRoleOf(row.role);
}

async function requireAdmin(
  db: Database,
  organizationId: string,
  userId: string,
  what = "the logo",
) {
  if ((await membership(db, organizationId, userId)) !== "admin")
    throw new LogoError(
      `Only organization administrators can change ${what}.`,
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
    await lock(tx, organizationId);
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
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const removed = await tx
      .delete(s.organizationLogo)
      .where(
        and(
          eq(s.organizationLogo.organizationId, organizationId),
          eq(s.organizationLogo.kind, kind),
        ),
      )
      .returning({ organizationId: s.organizationLogo.organizationId });
    if (removed.length) await refreshDirectoryProjection(tx, organizationId);
    return { removed: removed.length > 0 };
  });
}

// The image behind a public logo address (branding/logo.ts): found only by
// the exact hash of its current content, so replacing or removing a logo
// retires every address that was sent out for it.
export async function readPublicLogo(
  db: Database,
  organizationId: string,
  kind: LogoKind,
  sha256: string,
) {
  const [logo] = await db
    .select({
      content: s.organizationLogo.content,
      mimeType: s.organizationLogo.mimeType,
    })
    .from(s.organizationLogo)
    .where(
      and(
        eq(s.organizationLogo.organizationId, organizationId),
        eq(s.organizationLogo.kind, kind),
        eq(s.organizationLogo.sha256, sha256),
      ),
    );
  if (!logo) throw new LogoError("No logo uploaded.", 404);
  return logo;
}

// Sets the organization's brand color, or returns to Lictory's with null.
export async function setBrandColor(
  db: Database,
  organizationId: string,
  userId: string,
  color: string | null,
) {
  await requireAdmin(db, organizationId, userId, "the brand color");
  const brandColor = color === null ? null : normalizeBrandColor(color);
  if (color !== null && !brandColor)
    throw new LogoError(
      "Enter the brand color as six hexadecimal digits, for example #1d4ed8.",
      400,
    );
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await tx
      .insert(s.organizationBranding)
      .values({ organizationId, brandColor, updatedById: userId })
      .onConflictDoUpdate({
        target: s.organizationBranding.organizationId,
        set: { brandColor, updatedById: userId, updatedAt: sql`now()` },
      });
    await refreshDirectoryProjection(tx, organizationId);
  });
  return { brandColor };
}

export async function readBrandColor(db: Database, organizationId: string) {
  const [row] = await db
    .select({ brandColor: s.organizationBranding.brandColor })
    .from(s.organizationBranding)
    .where(eq(s.organizationBranding.organizationId, organizationId));
  return row?.brandColor ?? null;
}

const EMAIL_LOGO_HEIGHT = 34;
const EMAIL_LOGO_MAX_WIDTH = 240;

// The look of email sent on an organization's behalf (see EmailBrand).
export async function emailBrand(
  db: Database,
  organizationId: string,
  organizationName: string,
  baseUrl: string,
): Promise<EmailBrand> {
  const [logos, color] = await Promise.all([
    db
      .select({
        kind: s.organizationLogo.kind,
        content: s.organizationLogo.content,
        sha256: s.organizationLogo.sha256,
      })
      .from(s.organizationLogo)
      .where(
        and(
          eq(s.organizationLogo.organizationId, organizationId),
          inArray(s.organizationLogo.kind, ["mark", "full"]),
        ),
      ),
    readBrandColor(db, organizationId),
  ]);
  const chosen =
    logos.find((l) => l.kind === "full") ??
    logos.find((l) => l.kind === "mark");
  let logo: EmailBrand["logo"] = null;
  if (chosen) {
    const kind = chosen.kind as "mark" | "full";
    // A logomark is shown square; a wide logo keeps its proportions within
    // the header. Without readable dimensions, assume the documented shape.
    const natural = imageSize(new Uint8Array(chosen.content)) ?? {
      width: kind === "full" ? 6 : 1,
      height: 1,
    };
    const scale = Math.min(
      EMAIL_LOGO_HEIGHT / natural.height,
      (kind === "full" ? EMAIL_LOGO_MAX_WIDTH : EMAIL_LOGO_HEIGHT) /
        natural.width,
    );
    logo = {
      kind,
      url: new URL(
        publicLogoPath(organizationId, kind, chosen.sha256),
        baseUrl,
      ).toString(),
      width: Math.max(1, Math.round(natural.width * scale)),
      height: Math.max(1, Math.round(natural.height * scale)),
    };
  }
  return {
    name: organizationName,
    logo,
    tone: color ? brandPalette(color).light : null,
  };
}
