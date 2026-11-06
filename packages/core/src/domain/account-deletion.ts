import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { refreshDirectoryProjection } from "@lictory/core/domain/projections";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { refreshSpaceAccess } from "@lictory/core/spaces/access";
import { writeSpaceProjections } from "@lictory/core/spaces/projections";

// Deleting an account anonymizes it rather than removing the row: revisions,
// reviews, approvals, threads and audit entries keep referring to the person,
// and history must not change (AGENTS.md). Everything that lets the account
// act, reach the person or show their likeness goes; the display name stays
// so history remains attributed. See docs/internals/account-deletion.md.

export class AccountDeletionError extends Error {
  constructor(
    readonly code: "sole_owner" | "last_administrator",
    message: string,
  ) {
    super(message);
  }
}

// An address that can never receive mail or match a sign-in (RFC 2606), so
// the person can sign up again with their real one.
export const deletedEmail = (userId: string) =>
  `deleted-${userId}@deleted.invalid`;

const isOwner = (role: string) => role.split(",").includes("owner");

const formatList = (names: string[]) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// Organizations whose only owner is this person. Leaving them without an
// owner would strand them, so deletion is refused until ownership moves or
// the organization is scheduled for deletion (which then runs on its date
// without an owner to cancel it).
async function soleOwnerships(tx: Tx, userId: string) {
  const owned = await tx
    .select({
      id: s.organization.id,
      name: s.organization.name,
      role: s.member.role,
    })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .leftJoin(
      s.organizationDeletion,
      eq(s.organizationDeletion.organizationId, s.member.organizationId),
    )
    .where(
      and(
        eq(s.member.userId, userId),
        isNull(s.organizationDeletion.organizationId),
      ),
    );
  const ownedIds = owned.filter((o) => isOwner(o.role)).map((o) => o.id);
  if (!ownedIds.length) return [];
  const others = await tx
    .select({ organizationId: s.member.organizationId, role: s.member.role })
    .from(s.member)
    .where(
      and(
        inArray(s.member.organizationId, ownedIds),
        ne(s.member.userId, userId),
      ),
    );
  const coOwned = new Set(
    others.filter((m) => isOwner(m.role)).map((m) => m.organizationId),
  );
  return owned
    .filter((o) => ownedIds.includes(o.id) && !coOwned.has(o.id))
    .map((o) => o.name)
    .sort((a, b) => a.localeCompare(b));
}

async function assertDeletable(tx: Tx, user: typeof s.user.$inferSelect) {
  const sole = await soleOwnerships(tx, user.id);
  if (sole.length)
    throw new AccountDeletionError(
      "sole_owner",
      `You are the only owner of ${formatList(sole)}. Make another member an owner, or delete the organization in Organization settings → Delete organization, then delete your account.`,
    );
  if (user.instanceAdmin && !user.deactivatedAt) {
    const [other] = await tx
      .select({ id: s.user.id })
      .from(s.user)
      .where(
        and(
          eq(s.user.instanceAdmin, true),
          isNull(s.user.deactivatedAt),
          ne(s.user.id, user.id),
        ),
      )
      .limit(1);
    if (!other)
      throw new AccountDeletionError(
        "last_administrator",
        "You are this installation's only active administrator. Make someone else an administrator first, then delete your account.",
      );
  }
}

// Anonymizes the account in one transaction. Idempotent: an account that is
// already deleted is left as it is. Returns the organizations the person left.
export async function deleteAccount(db: Database, userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(s.user)
      .where(eq(s.user.id, userId))
      .for("update");
    if (!user || user.deletedAt) return { organizationIds: [] as string[] };
    const organizationIds = (
      await tx
        .select({ id: s.member.organizationId })
        .from(s.member)
        .where(eq(s.member.userId, userId))
    )
      .map((m) => m.id)
      .sort();
    // A fixed lock order, as every multi-organization writer uses, so
    // concurrent writers cannot deadlock; ownership is checked under the locks.
    for (const organizationId of organizationIds)
      await lock(tx, organizationId);
    await assertDeletable(tx, user);

    // Sign-in methods and everything that acts as the person.
    await tx.delete(s.session).where(eq(s.session.userId, userId));
    await tx.delete(s.account).where(eq(s.account.userId, userId));
    await tx.delete(s.twoFactor).where(eq(s.twoFactor.userId, userId));
    await tx.delete(s.passkey).where(eq(s.passkey.userId, userId));
    await tx.delete(s.accessToken).where(eq(s.accessToken.userId, userId));
    // Records of what their agents called (docs/internals/audit.md).
    await tx
      .delete(s.capabilityInvocation)
      .where(eq(s.capabilityInvocation.userId, userId));
    // Pending password reset and similar one-time tokens name the account.
    await tx.delete(s.verification).where(eq(s.verification.value, userId));
    // Personal data that is not history: the photo, private assistant
    // conversations, the notification inbox and its preferences.
    await tx.delete(s.profilePhoto).where(eq(s.profilePhoto.userId, userId));
    await tx
      .delete(s.intelligenceChat)
      .where(eq(s.intelligenceChat.userId, userId));
    // Queued notification emails go with their notifications.
    await tx.delete(s.notification).where(eq(s.notification.userId, userId));
    await tx
      .delete(s.notificationPreference)
      .where(eq(s.notificationPreference.userId, userId));
    await tx
      .delete(s.workItemWatcher)
      .where(eq(s.workItemWatcher.userId, userId));
    // Memberships. Reviews and approvals they gave stay, as when a member is
    // removed; the person is listed as a former member instead.
    await tx.delete(s.teamMember).where(eq(s.teamMember.userId, userId));
    await tx
      .delete(s.disciplineMember)
      .where(eq(s.disciplineMember.userId, userId));
    await tx.delete(s.projectMember).where(eq(s.projectMember.userId, userId));
    // Named Spaces access is access, not history; spaces they created,
    // pages and commits they wrote and branches they collaborated on stay
    // attributed to them (and grant nothing without membership).
    const grantedSpaces = await tx
      .delete(s.spaceGrant)
      .where(eq(s.spaceGrant.userId, userId))
      .returning({
        organizationId: s.spaceGrant.organizationId,
        spaceId: s.spaceGrant.spaceId,
      });
    await tx.delete(s.member).where(eq(s.member.userId, userId));
    if (organizationIds.length)
      await tx
        .insert(s.formerMember)
        .values(
          organizationIds.map((organizationId) => ({ organizationId, userId })),
        )
        .onConflictDoUpdate({
          target: [s.formerMember.organizationId, s.formerMember.userId],
          set: { leftAt: sql`now()` },
        });

    const now = new Date();
    await tx
      .update(s.user)
      .set({
        email: deletedEmail(userId),
        emailVerified: false,
        image: null,
        handle: null,
        twoFactorEnabled: false,
        instanceAdmin: false,
        deactivatedAt: user.deactivatedAt ?? now,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(s.user.id, userId));

    for (const organizationId of organizationIds) {
      await recordAuditEvent(tx, {
        organizationId,
        actor: { id: userId, name: user.name, email: user.email },
        action: "member.account_deleted",
        target: { type: "member", id: userId, label: user.name || user.email },
      });
      await refreshDirectoryProjection(tx, organizationId);
      await refreshSpaceAccess(tx, organizationId, { userIds: [userId] });
      await writeSpaceProjections(tx, organizationId, {
        spaces: grantedSpaces
          .filter((g) => g.organizationId === organizationId)
          .map((g) => g.spaceId),
      });
    }
    // Instance administrators see the deletion in the installation history.
    await tx.insert(s.instanceAuditEvent).values({
      actorId: userId,
      actorName: user.name,
      actorEmail: user.email,
      via: "web",
      action: "user.deleted",
      targetType: "user",
      targetId: userId,
      targetLabel: user.name || user.email,
      detail: { organizationIds },
    });
    return { organizationIds };
  });
}

// Records that someone left an organization (removed or left by themselves)
// and refreshes its directory, which keeps listing them by name.
export async function recordDeparture(
  db: Database,
  organizationId: string,
  userId: string,
) {
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const [stillMember] = await tx
      .select({ id: s.member.id })
      .from(s.member)
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          eq(s.member.userId, userId),
        ),
      );
    if (!stillMember)
      await tx
        .insert(s.formerMember)
        .values({ organizationId, userId })
        .onConflictDoUpdate({
          target: [s.formerMember.organizationId, s.formerMember.userId],
          set: { leftAt: sql`now()` },
        });
    await refreshDirectoryProjection(tx, organizationId);
    // Spaces access follows organization membership; grants stay (and grant
    // nothing) like project memberships, in case the person rejoins.
    await refreshSpaceAccess(tx, organizationId, { userIds: [userId] });
  });
}

// Organizations whose directory names this person: as a member or as a
// former member. A name change refreshes all of them.
export async function directoriesListing(db: Database | Tx, userId: string) {
  const rows = await db
    .select({ id: s.organization.id })
    .from(s.organization)
    .where(
      or(
        inArray(
          s.organization.id,
          db
            .select({ id: s.member.organizationId })
            .from(s.member)
            .where(eq(s.member.userId, userId)),
        ),
        inArray(
          s.organization.id,
          db
            .select({ id: s.formerMember.organizationId })
            .from(s.formerMember)
            .where(eq(s.formerMember.userId, userId)),
        ),
      ),
    );
  return rows.map((r) => r.id).sort();
}
