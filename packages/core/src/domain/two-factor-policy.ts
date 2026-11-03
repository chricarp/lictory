import { and, asc, eq, like, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database, Tx } from "@lictory/core/domain/service";

// Organization policy "require two-factor for members".
//
// Two-factor authentication is a property of the person (Better Auth's
// `twoFactorEnabled`: a verified authenticator app with backup codes). An
// organization that requires it treats a member without it as held: they
// stay a member and can enroll, but cannot read or change the organization's
// data until they do. The hold is enforced on the server wherever
// organization access is authorized (see docs/internals/two-factor-authentication.md).
//
// Passkeys are a sign-in method, not a second factor for the password: a
// person with a passkey and no authenticator app can still sign in with the
// password alone, so passkeys do not satisfy the requirement.

const TWO_FACTOR_REQUIRED = "two_factor_required";

export function twoFactorRequiredError(organizationName?: string) {
  return new DomainError(
    "forbidden",
    `${organizationName ?? "This organization"} requires two-factor authentication. Turn it on in Account settings → Security to continue.`,
    undefined,
    TWO_FACTOR_REQUIRED,
  );
}

// A held member: the organization requires two-factor and the person has
// none. `requireTwoFactor` is null when the organization has no policy row.
export function isTwoFactorHeld(
  requireTwoFactor: boolean | null | undefined,
  twoFactorEnabled: boolean | null | undefined,
) {
  return Boolean(requireTwoFactor) && !twoFactorEnabled;
}

// Organizations whose policy currently holds this person. Only memberships
// are considered, so nothing is disclosed about other organizations.
export async function heldOrganizations(db: Database | Tx, userId: string) {
  return db
    .select({
      id: s.organization.id,
      name: s.organization.name,
      slug: s.organization.slug,
    })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .innerJoin(
      s.organizationSecurityPolicy,
      eq(s.organizationSecurityPolicy.organizationId, s.member.organizationId),
    )
    .innerJoin(s.user, eq(s.user.id, s.member.userId))
    .where(
      and(
        eq(s.member.userId, userId),
        eq(s.organizationSecurityPolicy.requireTwoFactor, true),
        sql`not coalesce(${s.user.twoFactorEnabled}, false)`,
      ),
    )
    .orderBy(asc(s.organization.name));
}

// Throws when this organization holds the person. Non-members pass: the
// caller's membership check answers them without revealing the policy.
export async function assertTwoFactorSatisfied(
  db: Database | Tx,
  userId: string,
  organizationId: string,
) {
  const [held] = await db
    .select({ name: s.organization.name })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .innerJoin(
      s.organizationSecurityPolicy,
      eq(s.organizationSecurityPolicy.organizationId, s.member.organizationId),
    )
    .innerJoin(s.user, eq(s.user.id, s.member.userId))
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
        eq(s.organizationSecurityPolicy.requireTwoFactor, true),
        sql`not coalesce(${s.user.twoFactorEnabled}, false)`,
      ),
    )
    .limit(1);
  if (held) throw twoFactorRequiredError(held.name);
}

async function administrator(
  db: Database | Tx,
  userId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({
      role: s.member.role,
      twoFactorEnabled: s.user.twoFactorEnabled,
    })
    .from(s.member)
    .innerJoin(s.user, eq(s.user.id, s.member.userId))
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
      ),
    );
  if (!row)
    throw new DomainError(
      "forbidden",
      "You are not a member of this organization.",
    );
  if (applicationRoleOf(row.role) !== "admin")
    throw new DomainError(
      "forbidden",
      "Only organization administrators can change security settings.",
    );
  return { role: row.role, twoFactorEnabled: Boolean(row.twoFactorEnabled) };
}

async function requireTwoFactorOf(db: Database | Tx, organizationId: string) {
  const [policy] = await db
    .select({ requireTwoFactor: s.organizationSecurityPolicy.requireTwoFactor })
    .from(s.organizationSecurityPolicy)
    .where(eq(s.organizationSecurityPolicy.organizationId, organizationId));
  return policy?.requireTwoFactor ?? false;
}

// What administrators see in Organization settings → Security: the policy
// and which members have two-factor authentication. Members' enrollment is
// visible to administrators only.
export async function getOrganizationSecurity(
  db: Database,
  userId: string,
  organizationId: string,
) {
  const actor = await administrator(db, userId, organizationId);
  const [requireTwoFactor, members] = await Promise.all([
    requireTwoFactorOf(db, organizationId),
    db
      .select({
        userId: s.user.id,
        name: s.user.name,
        email: s.user.email,
        role: s.member.role,
        twoFactorEnabled: s.user.twoFactorEnabled,
      })
      .from(s.member)
      .innerJoin(s.user, eq(s.user.id, s.member.userId))
      .where(eq(s.member.organizationId, organizationId))
      .orderBy(asc(s.user.name), asc(s.user.email)),
  ]);
  return {
    requireTwoFactor,
    actorTwoFactorEnabled: actor.twoFactorEnabled,
    members: members.map((m) => ({
      ...m,
      role: applicationRoleOf(m.role),
      twoFactorEnabled: Boolean(m.twoFactorEnabled),
    })),
  };
}

async function lock(tx: Tx, organizationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
  );
}

async function auditSecurity(
  tx: Tx,
  organizationId: string,
  actorId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  await tx.insert(s.configurationAudit).values({
    organizationId,
    actorId,
    action,
    detail,
  });
}

// Turning the requirement on needs the administrator's own two-factor, so
// the person enabling it is never the first one locked out. Turning it off
// is always possible for an administrator who can reach the organization.
export async function setTwoFactorRequirement(
  db: Database,
  userId: string,
  organizationId: string,
  required: boolean,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const actor = await administrator(tx, userId, organizationId);
    if (required && !actor.twoFactorEnabled)
      throw new DomainError(
        "validation",
        "Turn on two-factor authentication for your own account (Account settings → Security) before requiring it for members.",
      );
    const previous = await requireTwoFactorOf(tx, organizationId);
    if (previous !== required) {
      await tx
        .insert(s.organizationSecurityPolicy)
        .values({
          organizationId,
          requireTwoFactor: required,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: s.organizationSecurityPolicy.organizationId,
          set: {
            requireTwoFactor: required,
            updatedBy: userId,
            updatedAt: new Date(),
          },
        });
      await auditSecurity(
        tx,
        organizationId,
        userId,
        "setTwoFactorRequirement",
        {
          requireTwoFactor: required,
          previous: { requireTwoFactor: previous },
        },
      );
    }
    const [{ held }] = (await tx
      .select({ held: sql<number>`count(*)::int` })
      .from(s.member)
      .innerJoin(s.user, eq(s.user.id, s.member.userId))
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          sql`not coalesce(${s.user.twoFactorEnabled}, false)`,
        ),
      )) as [{ held: number }];
    return {
      requireTwoFactor: required,
      changed: previous !== required,
      membersWithoutTwoFactor: held,
    };
  });
}

// Recovery for a member who lost their authenticator and backup codes. It
// removes their authenticator, backup codes and trusted devices; their
// password and passkeys are untouched, and they are asked to enroll again
// when the organization requires two-factor. Owners can reset anyone;
// administrators cannot reset an owner. The acting administrator needs their
// own two-factor, so a password-only administrator account cannot strip
// others' second factor.
export async function resetMemberTwoFactor(
  db: Database,
  userId: string,
  organizationId: string,
  memberUserId: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const actor = await administrator(tx, userId, organizationId);
    if (memberUserId === userId)
      throw new DomainError(
        "validation",
        "Manage your own two-factor authentication in Account settings → Security.",
      );
    if (!actor.twoFactorEnabled)
      throw new DomainError(
        "validation",
        "Turn on two-factor authentication for your own account (Account settings → Security) before resetting a member's.",
      );
    const [target] = await tx
      .select({
        role: s.member.role,
        name: s.user.name,
        email: s.user.email,
        twoFactorEnabled: s.user.twoFactorEnabled,
      })
      .from(s.member)
      .innerJoin(s.user, eq(s.user.id, s.member.userId))
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          eq(s.member.userId, memberUserId),
        ),
      );
    if (!target)
      throw new DomainError(
        "not_found",
        "That person is not a member of this organization.",
      );
    if (target.role === "owner" && actor.role !== "owner")
      throw new DomainError(
        "forbidden",
        "Only an organization owner can reset an owner's two-factor authentication.",
      );
    if (!target.twoFactorEnabled)
      throw new DomainError(
        "validation",
        `${target.name} does not have two-factor authentication turned on.`,
      );
    await tx.delete(s.twoFactor).where(eq(s.twoFactor.userId, memberUserId));
    await tx
      .update(s.user)
      .set({ twoFactorEnabled: false })
      .where(eq(s.user.id, memberUserId));
    // Trusted-device records would otherwise skip the second factor of a
    // future enrollment on that browser.
    await tx
      .delete(s.verification)
      .where(
        and(
          like(s.verification.identifier, "trust-device-%"),
          eq(s.verification.value, memberUserId),
        ),
      );
    await auditSecurity(tx, organizationId, userId, "resetMemberTwoFactor", {
      memberUserId,
      memberEmail: target.email,
    });
    return {
      member: { userId: memberUserId, name: target.name, email: target.email },
    };
  });
}
