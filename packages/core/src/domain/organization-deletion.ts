import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { DomainError } from "@lictory/core/domain/errors";
import {
  deletionDay,
  isOwnerRole,
} from "@lictory/core/domain/organization-access";
import { refreshDirectoryProjection } from "@lictory/core/domain/projections";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import { assertTwoFactorSatisfied } from "@lictory/core/domain/two-factor-policy";
import { deliverNotifications } from "@lictory/core/notifications/server";
import { StorageConfigurationError } from "@lictory/core/storage/errors";
import type { ObjectStorage } from "@lictory/core/storage/s3";

// Organization deletion. An owner schedules it; the organization is locked
// for a grace period (owners can still export its data and cancel); then the
// worker deletes the stored files and every organization row, and records
// the deletion in the installation's history, which no organization owns.
// See docs/internals/organization-deletion.md.

const DAY_MS = 86_400_000;
// The database phase is one transaction that cannot renew its lease, so the
// lease covers a large organization's deletion.
const LEASE_MS = 30 * 60_000;
const RETRY_MS = 15 * 60_000;
const FILE_PAGE = 200;

export type OrganizationDeletionView = {
  organizationId: string;
  status: "scheduled" | "deleting";
  requestedBy: { id: string; name: string | null };
  requestedAt: string;
  deleteAfter: string;
};

type DeletionRow = typeof s.organizationDeletion.$inferSelect;

function view(row: DeletionRow): OrganizationDeletionView {
  return {
    organizationId: row.organizationId,
    status: row.status as OrganizationDeletionView["status"],
    requestedBy: { id: row.requestedById, name: row.requestedByName },
    requestedAt: row.requestedAt.toISOString(),
    deleteAfter: row.deleteAfter.toISOString(),
  };
}

// Only owners delete an organization or cancel its deletion. Checked inside
// the caller's transaction, under the organization lock.
async function requireOwner(tx: Tx, userId: string, organizationId: string) {
  const [row] = await tx
    .select({
      role: s.member.role,
      name: s.organization.name,
      slug: s.organization.slug,
      userName: s.user.name,
      userEmail: s.user.email,
    })
    .from(s.member)
    .innerJoin(s.organization, eq(s.organization.id, s.member.organizationId))
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
  if (!isOwnerRole(row.role))
    throw new DomainError(
      "forbidden",
      "Only an owner of the organization can delete it or cancel its deletion.",
    );
  await assertTwoFactorSatisfied(tx, userId, organizationId);
  return row;
}

async function memberIds(tx: Tx, organizationId: string) {
  return (
    await tx
      .select({ userId: s.member.userId })
      .from(s.member)
      .where(eq(s.member.organizationId, organizationId))
  ).map((m) => m.userId);
}

// Schedules the deletion `graceDays` from now, locking the organization at
// once. The owner confirms by typing the organization's handle. Idempotent:
// a deletion already scheduled is returned unchanged.
export async function scheduleOrganizationDeletion(
  db: Database,
  userId: string,
  organizationId: string,
  input: { confirmation: string; graceDays: number; now?: Date },
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const owner = await requireOwner(tx, userId, organizationId);
    const [existing] = await tx
      .select()
      .from(s.organizationDeletion)
      .where(eq(s.organizationDeletion.organizationId, organizationId));
    if (existing) return { deletion: view(existing), existing: true };
    if (input.confirmation.trim().toLowerCase() !== owner.slug.toLowerCase())
      throw new DomainError(
        "validation",
        `Type the organization's handle, ${owner.slug}, to confirm the deletion.`,
      );
    const now = input.now ?? new Date();
    const deleteAfter = new Date(now.getTime() + input.graceDays * DAY_MS);
    const [created] = await tx
      .insert(s.organizationDeletion)
      .values({
        organizationId,
        requestedById: userId,
        requestedByName: owner.userName,
        requestedAt: now,
        deleteAfter,
      })
      .returning();
    const target = { type: "organization", id: organizationId };
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId, name: owner.userName, email: owner.userEmail },
      action: "organization.deletion_scheduled",
      target: { ...target, label: owner.name },
      detail: {
        deleteAfter: deleteAfter.toISOString(),
        graceDays: input.graceDays,
      },
    });
    await tx.insert(s.instanceAuditEvent).values({
      actorId: userId,
      actorName: owner.userName,
      actorEmail: owner.userEmail,
      via: "web",
      action: "organization.deletion_scheduled",
      targetType: target.type,
      targetId: organizationId,
      targetLabel: owner.name,
      detail: { slug: owner.slug, deleteAfter: deleteAfter.toISOString() },
    });
    await deliverNotifications(
      tx,
      organizationId,
      (await memberIds(tx, organizationId)).map((memberId) => ({
        userId: memberId,
        kind: "organization_deletion_scheduled" as const,
        actorId: userId,
        detail: {
          organizationName: owner.name,
          deleteAfter: deleteAfter.toISOString(),
          deleteDay: deletionDay(deleteAfter),
        },
        dedupeKey: `organization-deletion:${organizationId}:${now.getTime()}`,
      })),
    );
    // The profile carries the deletion, so every member's app locks now.
    await refreshDirectoryProjection(tx, organizationId);
    return { deletion: view(created!), existing: false };
  });
}

// Cancels a scheduled deletion and opens the organization again. Refused
// once the worker has started deleting. Idempotent: nothing scheduled
// returns `cancelled: false`.
export async function cancelOrganizationDeletion(
  db: Database,
  userId: string,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    const owner = await requireOwner(tx, userId, organizationId);
    // Locks the row against the worker's claim (which skips locked rows).
    const [row] = await tx
      .select()
      .from(s.organizationDeletion)
      .where(eq(s.organizationDeletion.organizationId, organizationId))
      .for("update");
    if (!row) return { cancelled: false };
    if (row.status !== "scheduled")
      throw new DomainError(
        "conflict",
        "The deletion has started and can no longer be cancelled.",
      );
    await tx
      .delete(s.organizationDeletion)
      .where(eq(s.organizationDeletion.organizationId, organizationId));
    const target = { type: "organization", id: organizationId };
    const detail = { deleteAfter: row.deleteAfter.toISOString() };
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId, name: owner.userName, email: owner.userEmail },
      action: "organization.deletion_cancelled",
      target: { ...target, label: owner.name },
      detail,
    });
    await tx.insert(s.instanceAuditEvent).values({
      actorId: userId,
      actorName: owner.userName,
      actorEmail: owner.userEmail,
      via: "web",
      action: "organization.deletion_cancelled",
      targetType: target.type,
      targetId: organizationId,
      targetLabel: owner.name,
      detail: { slug: owner.slug, ...detail },
    });
    await deliverNotifications(
      tx,
      organizationId,
      (await memberIds(tx, organizationId)).map((memberId) => ({
        userId: memberId,
        kind: "organization_deletion_cancelled" as const,
        actorId: userId,
        detail: { organizationName: owner.name },
        dedupeKey: `organization-deletion-cancelled:${organizationId}:${Date.now()}`,
      })),
    );
    await refreshDirectoryProjection(tx, organizationId);
    return { cancelled: true };
  });
}

// Every organization table whose rows do not go with the organization row
// itself (`ON DELETE RESTRICT` or `NO ACTION`), children before the rows
// they reference. Tables that cascade from `organization` (members,
// invitations, the audit log, projections, exports, Litto conversations,
// notification preferences, former members, the security policy and this
// deletion) are removed by deleting the organization last. The audit log can
// only go that way: its trigger refuses deletes while the organization row
// exists. organization-deletion.test.ts checks this list against the
// database's foreign keys, so a new table fails the test until it is added.
export const deletionOrder: readonly PgTable[] = [
  s.notificationEmail,
  s.notification,
  s.workItemWatcher,
  s.intelligenceContextVersion,
  s.intelligenceContextEntry,
  s.aiRun,
  s.decision,
  s.threadMessage,
  s.thread,
  s.suggestionDecision,
  s.suggestionReviewer,
  s.suggestion,
  s.approval,
  s.reviewAssignment,
  s.review,
  s.pullRequestReview,
  s.specificationPullRequest,
  s.specificationBranch,
  s.readinessCheck,
  s.readinessSignOff,
  s.workItemExternalLink,
  s.deliveryPublication,
  s.deliveryTarget,
  // Delivery credentials (encrypted) are columns of their connection.
  s.deliveryConnection,
  s.specificationCommit,
  s.specificationRevision,
  s.fileObject,
  s.iterationEvent,
  s.workItemLabel,
  s.workItemRelation,
  s.workItem,
  // Lictory Spaces: discussions and drafts, then history, then pages and
  // spaces (which reference projects and teams). Effective access and
  // projections cascade with their space and organization.
  s.pageThreadMessage,
  s.pageThread,
  s.pageActivity,
  s.spaceDraftUpdate,
  s.spaceDraft,
  s.pageBranchCollaborator,
  s.pageBranch,
  s.pageCommit,
  s.page,
  s.spaceGrant,
  s.space,
  s.organizationOnboarding,
  s.teamMember,
  s.team,
  s.iteration,
  s.milestone,
  s.label,
  s.workflowStatus,
  s.projectWorkItemType,
  s.workItemType,
  s.disciplineMember,
  s.discipline,
  s.readinessRevision,
  s.projectMember,
  s.project,
  s.organizationAiPolicy,
  s.organizationLogo,
  s.activity,
  s.syncMutation,
];

class LeaseLost extends Error {}

// A failure an operator can act on; its message is stored for the console.
class DeletionBlocked extends Error {}

// Claims at most one due deletion and carries it out. Safe to run in several
// workers: the claim uses SKIP LOCKED and a lease, every step is idempotent,
// and only the claiming attempt may finish. A failed attempt is retried
// after RETRY_MS with its reason recorded; a graceful stop hands the
// deletion back without spending an attempt.
export async function processOrganizationDeletions(
  db: Database,
  options: {
    storage?: () => ObjectStorage | null;
    signal?: AbortSignal;
    now?: () => Date;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const at = now().toISOString();
  const [job] = await db
    .update(s.organizationDeletion)
    .set({
      status: "deleting",
      attempt: sql`${s.organizationDeletion.attempt} + 1`,
      leaseUntil: new Date(now().getTime() + LEASE_MS),
      startedAt: sql`coalesce(${s.organizationDeletion.startedAt}, now())`,
    })
    .where(
      sql`${s.organizationDeletion.organizationId} = (
        select organization_id from organization_deletion
        where delete_after <= ${at}::timestamp
          and (status = 'scheduled'
            or lease_until is null or lease_until < ${at}::timestamp)
        order by delete_after
        limit 1
        for update skip locked)`,
    )
    .returning();
  if (!job) return { claimed: 0, deleted: 0, failed: 0 };
  try {
    await deleteFiles(db, job, options, now);
    await deleteRows(db, job);
    return { claimed: 1, deleted: 1, failed: 0 };
  } catch (error) {
    if (error instanceof LeaseLost)
      return { claimed: 1, deleted: 0, failed: 0 };
    if (options.signal?.aborted) {
      await settle(db, job, {
        leaseUntil: null,
        attempt: sql`${s.organizationDeletion.attempt} - 1`,
      });
      return { claimed: 1, deleted: 0, failed: 0 };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        event: "organization_deletion.failed",
        organizationId: job.organizationId,
        attempt: job.attempt,
        error: message,
      }),
    );
    await settle(db, job, {
      leaseUntil: new Date(now().getTime() + RETRY_MS),
      error: (error instanceof DeletionBlocked
        ? message
        : `The last attempt failed (${message}). Lictory retries automatically; the worker log has the details (organization_deletion.failed).`
      ).slice(0, 1000),
    });
    return { claimed: 1, deleted: 0, failed: 1 };
  }
}

// Updates the deletion only while this attempt still owns it.
function settle(
  db: Database,
  job: DeletionRow,
  values: Partial<Record<keyof DeletionRow, unknown>>,
) {
  return db
    .update(s.organizationDeletion)
    .set(values as Partial<typeof s.organizationDeletion.$inferInsert>)
    .where(
      and(
        eq(s.organizationDeletion.organizationId, job.organizationId),
        eq(s.organizationDeletion.attempt, job.attempt),
        eq(s.organizationDeletion.status, "deleting"),
      ),
    )
    .returning({ id: s.organizationDeletion.organizationId });
}

function configuredStorage(factory?: () => ObjectStorage | null) {
  try {
    return factory ? factory() : null;
  } catch (error) {
    if (error instanceof StorageConfigurationError) return null;
    throw error;
  }
}

// Deletes every stored object of the organization's attachments (pending,
// ready and removed ones alike), outside any transaction. Deleting a missing
// object succeeds, so a retry simply repeats the pages it already did.
async function deleteFiles(
  db: Database,
  job: DeletionRow,
  options: { storage?: () => ObjectStorage | null; signal?: AbortSignal },
  now: () => Date,
) {
  if (job.filesDeletedAt) return;
  const storage = configuredStorage(options.storage);
  let after: string | null = null;
  for (;;) {
    const page: { id: string; objectKey: string }[] = await db
      .select({ id: s.fileObject.id, objectKey: s.fileObject.objectKey })
      .from(s.fileObject)
      .where(
        and(
          eq(s.fileObject.organizationId, job.organizationId),
          after ? gt(s.fileObject.id, after) : undefined,
        ),
      )
      .orderBy(asc(s.fileObject.id))
      .limit(FILE_PAGE);
    if (!page.length) break;
    if (!storage) {
      const [count] = await db
        .select({ total: sql<number>`count(*)` })
        .from(s.fileObject)
        .where(eq(s.fileObject.organizationId, job.organizationId));
      throw new DeletionBlocked(
        `The organization has ${Number(count?.total ?? page.length)} stored files, but the worker has no file storage configured, so they cannot be deleted. Give the worker the same S3_* or R2_* settings as the API; the deletion retries automatically.`,
      );
    }
    for (const file of page) {
      if (options.signal?.aborted) throw new Error("The worker is stopping.");
      await storage.delete(file.objectKey);
    }
    after = page.at(-1)!.id;
    const held = await settle(db, job, {
      leaseUntil: new Date(now().getTime() + LEASE_MS),
    });
    if (!held.length) throw new LeaseLost();
  }
  const done = await settle(db, job, { filesDeletedAt: now() });
  if (!done.length) throw new LeaseLost();
}

const tableName = (table: PgTable) => getTableConfig(table).name;

// Deletes every row of the organization in one transaction, under its lock,
// and records the deletion in the installation's history. Accounts stay:
// they belong to people, who may be members of other organizations.
async function deleteRows(db: Database, job: DeletionRow) {
  await db.transaction(async (tx) => {
    await lock(tx, job.organizationId);
    const [current] = await tx
      .select({ attempt: s.organizationDeletion.attempt })
      .from(s.organizationDeletion)
      .where(
        and(
          eq(s.organizationDeletion.organizationId, job.organizationId),
          eq(s.organizationDeletion.status, "deleting"),
        ),
      )
      .for("update");
    if (current?.attempt !== job.attempt) throw new LeaseLost();
    const [organization] = await tx
      .select({ name: s.organization.name, slug: s.organization.slug })
      .from(s.organization)
      .where(eq(s.organization.id, job.organizationId));
    if (!organization) throw new LeaseLost();
    const [members] = await tx
      .select({ total: sql<number>`count(*)` })
      .from(s.member)
      .where(eq(s.member.organizationId, job.organizationId));
    const rows: Record<string, number> = {};
    for (const table of deletionOrder) {
      const result = await tx.execute(
        sql`delete from ${table} where organization_id = ${job.organizationId}`,
      );
      const count = (result as unknown as { count?: number }).count ?? 0;
      if (count) rows[tableName(table)] = count;
    }
    // Sessions remember the last organization a person opened.
    await tx
      .update(s.session)
      .set({ activeOrganizationId: null })
      .where(eq(s.session.activeOrganizationId, job.organizationId));
    await tx
      .delete(s.organization)
      .where(eq(s.organization.id, job.organizationId));
    await tx.insert(s.instanceAuditEvent).values({
      actorId: job.requestedById,
      actorName: job.requestedByName,
      via: "worker",
      action: "organization.deleted",
      targetType: "organization",
      targetId: job.organizationId,
      targetLabel: organization.name,
      detail: {
        slug: organization.slug,
        requestedAt: job.requestedAt.toISOString(),
        deleteAfter: job.deleteAfter.toISOString(),
        members: Number(members?.total ?? 0),
        files: rows.file_object ?? 0,
        rows,
      },
    });
  });
}
