import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import { assertTwoFactorSatisfied } from "@lictory/core/domain/two-factor-policy";
import type { Database, Tx } from "@lictory/core/domain/service";

// Whether a member may open an organization's data right now. Two things
// hold a member who otherwise belongs:
//
// - the organization requires two-factor authentication and they have none
//   (two-factor-policy.ts);
// - an owner scheduled the organization's deletion: it is locked until the
//   deletion runs or an owner cancels it. Only owners pass, and only where
//   the caller allows it (exporting the data, cancelling the deletion).
//
// Non-members pass: the caller's membership check answers them without
// revealing anything about the organization. See
// docs/internals/organization-deletion.md.

const DELETION_SCHEDULED = "organization_deletion_scheduled";

export const isOwnerRole = (role: string) => role.split(",").includes("owner");

// The day a deletion runs, as people read it in messages (UTC).
export const deletionDay = (deleteAfter: Date) =>
  deleteAfter.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export function deletionScheduledError(
  organizationName: string,
  deleteAfter: Date,
  owner: boolean,
) {
  return new DomainError(
    "forbidden",
    `${organizationName} is scheduled for deletion on ${deletionDay(deleteAfter)} and is locked until then. ${
      owner
        ? "Cancel the deletion to open it again."
        : "If this is a mistake, ask an owner to cancel the deletion."
    }`,
    undefined,
    DELETION_SCHEDULED,
  );
}

// Throws when the organization is scheduled for deletion. `owners: true`
// lets its owners through, for what they may still do while it is locked.
export async function assertNotScheduledForDeletion(
  db: Database | Tx,
  userId: string,
  organizationId: string,
  options: { owners?: boolean } = {},
) {
  const [row] = await db
    .select({
      name: s.organization.name,
      deleteAfter: s.organizationDeletion.deleteAfter,
      role: s.member.role,
    })
    .from(s.organizationDeletion)
    .innerJoin(
      s.organization,
      eq(s.organization.id, s.organizationDeletion.organizationId),
    )
    .innerJoin(
      s.member,
      and(
        eq(s.member.organizationId, s.organizationDeletion.organizationId),
        eq(s.member.userId, userId),
      ),
    )
    .where(eq(s.organizationDeletion.organizationId, organizationId))
    .limit(1);
  if (!row) return;
  const owner = isOwnerRole(row.role);
  if (options.owners && owner) return;
  throw deletionScheduledError(row.name, row.deleteAfter, owner);
}

// Every hold on organization access, for callers outside the domain
// mutation path (capabilities, files, Litto, exports, the audit log).
export async function assertOrganizationAccess(
  db: Database | Tx,
  userId: string,
  organizationId: string,
  options: { owners?: boolean } = {},
) {
  await assertTwoFactorSatisfied(db, userId, organizationId);
  await assertNotScheduledForDeletion(db, userId, organizationId, options);
}

// Organizations of this person that are scheduled for deletion. Only
// memberships are considered, so nothing is disclosed about others.
export async function organizationsScheduledForDeletion(
  db: Database | Tx,
  userId: string,
) {
  return db
    .select({
      id: s.organization.id,
      name: s.organization.name,
      deleteAfter: s.organizationDeletion.deleteAfter,
      role: s.member.role,
    })
    .from(s.member)
    .innerJoin(
      s.organizationDeletion,
      eq(s.organizationDeletion.organizationId, s.member.organizationId),
    )
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
    .where(eq(s.member.userId, userId));
}
