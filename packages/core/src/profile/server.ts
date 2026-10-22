import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import { normalizePhoto, PhotoError } from "@lictory/core/profile/image";
import { MAX_PROFILE_PHOTO_SIZE, profilePhotoUrl } from "@lictory/core/profile/photo";

type Database = PostgresJsDatabase<typeof s>;

// Some providers (Microsoft) return photo bytes rather than a URL. Normalize
// them after account creation so auth/session payloads only carry an image URL.
export async function importProviderPhoto(
  db: Database,
  user: { id: string; image?: string | null },
) {
  if (!user.image?.startsWith("data:")) return;
  const match =
    /^data:image\/(?:jpeg|png|webp);base64,\s*([A-Za-z0-9+/=]+)$/.exec(
      user.image,
    );
  try {
    if (
      !match?.[1] ||
      match[1].length > Math.ceil(MAX_PROFILE_PHOTO_SIZE / 3) * 4
    )
      throw new PhotoError("Invalid provider photo.", 400);
    user.image = (
      await setProfilePhoto(db, user.id, Buffer.from(match[1], "base64"))
    ).image;
  } catch (error) {
    if (!(error instanceof PhotoError)) throw error;
    // A bad provider photo must not prevent signup.
    user.image = (await setProfilePhoto(db, user.id, null)).image;
  }
}

export async function setProfilePhoto(
  db: Database,
  userId: string,
  bytes: Uint8Array | null,
) {
  const content = bytes === null ? null : await normalizePhoto(bytes);
  const sha256 = content
    ? createHash("sha256").update(content).digest("hex")
    : null;
  const image = sha256 ? profilePhotoUrl(userId, sha256) : null;
  await db.transaction(async (tx) => {
    // Serialize replacement/removal on the user row; URL and bytes commit together.
    await tx
      .select({ id: s.user.id })
      .from(s.user)
      .where(eq(s.user.id, userId))
      .for("update");
    if (content && sha256)
      await tx
        .insert(s.profilePhoto)
        .values({ userId, content, sha256 })
        .onConflictDoUpdate({
          target: s.profilePhoto.userId,
          set: { content, sha256 },
        });
    else
      await tx.delete(s.profilePhoto).where(eq(s.profilePhoto.userId, userId));
    await tx.update(s.user).set({ image }).where(eq(s.user.id, userId));
    const memberships = await tx
      .select({ organizationId: s.member.organizationId })
      .from(s.member)
      .where(eq(s.member.userId, userId));
    for (const { organizationId } of memberships) {
      const [clock] = await tx
        .select({ cursor: s.syncClock.cursor })
        .from(s.syncClock)
        .where(eq(s.syncClock.organizationId, organizationId));
      await tx.execute(
        sql`select pg_notify('lictory_sync', ${JSON.stringify({ organizationId, cursor: (clock?.cursor ?? 0n).toString() })})`,
      );
    }
  });
  return { image };
}

export async function readProfilePhoto(
  db: Database,
  viewerId: string,
  userId: string,
) {
  if (viewerId !== userId) {
    const organizations = db
      .select({ id: s.member.organizationId })
      .from(s.member)
      .where(eq(s.member.userId, viewerId));
    const [shared] = await db
      .select({ id: s.member.id })
      .from(s.member)
      .where(
        and(
          eq(s.member.userId, userId),
          inArray(s.member.organizationId, organizations),
        ),
      )
      .limit(1);
    if (!shared) throw new PhotoError("Photo not found.", 404);
  }
  const [photo] = await db
    .select()
    .from(s.profilePhoto)
    .where(eq(s.profilePhoto.userId, userId));
  if (!photo) throw new PhotoError("Photo not found.", 404);
  return photo;
}
