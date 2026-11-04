import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { assertOrganizationAccess } from "@lictory/core/domain/organization-access";
import { DomainError } from "@lictory/core/domain/errors";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import {
  ArchiveWriter,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  manifest,
  writeAttachments,
  writeSnapshot,
  type ExportSummary,
} from "@lictory/core/export/archive";
import type { ExportSummaryView } from "@lictory/core/export/types";
import { signalWork } from "@lictory/core/jobs/signal";
import { StorageConfigurationError } from "@lictory/core/storage/errors";
import type { ObjectStorage } from "@lictory/core/storage/s3";

// Organization data exports: requested by an administrator, built by the
// worker, downloaded from the API. See docs/internals/data-export.md.

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;
const RETRY_MS = 60_000;
const MAX_ATTEMPTS = 3;
// How long a finished archive can be downloaded.
export const EXPORT_RETENTION_DAYS = 7;

type ExportRow = typeof s.organizationExport.$inferSelect;

async function requireOrganizationAdmin(
  db: Database | Tx,
  userId: string,
  organizationId: string,
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
  if (!row || applicationRoleOf(row.role) !== "admin")
    throw new DomainError(
      "forbidden",
      "Only organization administrators can export the organization's data.",
    );
  // The archive download route reaches this without the capability
  // registry's check; a held administrator gets nothing either way. While
  // the organization is scheduled for deletion its owners can still export.
  await assertOrganizationAccess(db, userId, organizationId, { owners: true });
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

function view(row: ExportRow, requester: string | null): ExportSummaryView {
  return {
    id: row.id,
    status: row.status as ExportSummaryView["status"],
    requestedBy: { id: row.requestedById, name: requester },
    createdAt: row.createdAt.toISOString(),
    completedAt: iso(row.completedAt),
    expiresAt: iso(row.expiresAt),
    size: row.size,
    sha256: row.sha256,
    formatVersion: row.formatVersion,
    error: row.error,
    summary: row.summary ?? null,
  };
}

// Queues an export, or returns the one already queued or running: one export
// per organization at a time. The row, its audit entry and the worker signal
// commit together.
export async function requestOrganizationExport(
  db: Database,
  userId: string,
  organizationId: string,
) {
  return db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await requireOrganizationAdmin(tx, userId, organizationId);
    const [active] = await tx
      .select()
      .from(s.organizationExport)
      .where(
        and(
          eq(s.organizationExport.organizationId, organizationId),
          inArray(s.organizationExport.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (active) return { export: view(active, null), existing: true };
    const [created] = await tx
      .insert(s.organizationExport)
      .values({
        organizationId,
        requestedById: userId,
        formatVersion: EXPORT_FORMAT_VERSION,
      })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "data_export.requested",
      target: { type: "organization_export", id: created!.id },
      detail: { formatVersion: EXPORT_FORMAT_VERSION },
    });
    await signalWork(tx, "export");
    return { export: view(created!, null), existing: false };
  });
}

export async function listOrganizationExports(
  db: Database,
  userId: string,
  organizationId: string,
) {
  await requireOrganizationAdmin(db, userId, organizationId);
  const rows = await db
    .select({ row: s.organizationExport, requester: s.user.name })
    .from(s.organizationExport)
    .leftJoin(s.user, eq(s.user.id, s.organizationExport.requestedById))
    .where(eq(s.organizationExport.organizationId, organizationId))
    .orderBy(desc(s.organizationExport.createdAt))
    .limit(10);
  return {
    exports: rows.map((r) => view(r.row, r.requester)),
    retentionDays: EXPORT_RETENTION_DAYS,
  };
}

// Opens a finished archive for an administrator: authorized and audited
// before the first byte, then streamed chunk by chunk.
export async function openOrganizationExport(
  db: Database,
  userId: string,
  organizationId: string,
  exportId: string,
  now = new Date(),
) {
  await requireOrganizationAdmin(db, userId, organizationId);
  const [row] = await db
    .select()
    .from(s.organizationExport)
    .where(
      and(
        eq(s.organizationExport.organizationId, organizationId),
        eq(s.organizationExport.id, exportId),
      ),
    );
  if (!row) throw new DomainError("not_found", "This export does not exist.");
  if (
    row.status === "expired" ||
    (row.expiresAt && row.expiresAt.getTime() <= now.getTime())
  )
    throw new DomainError(
      "not_found",
      `This export expired after ${EXPORT_RETENTION_DAYS} days. Start a new export.`,
    );
  if (row.status !== "ready" || row.readyAttempt === null)
    throw new DomainError("conflict", "This export is not finished yet.");
  await recordAuditEvent(db, {
    organizationId,
    actor: { id: userId },
    action: "data_export.downloaded",
    target: { type: "organization_export", id: row.id },
    detail: { size: row.size, sha256: row.sha256 },
  });
  const attempt = row.readyAttempt;
  async function* chunks() {
    for (let sequence = 0; ; sequence++) {
      const [chunk] = await db
        .select({ data: s.organizationExportChunk.data })
        .from(s.organizationExportChunk)
        .where(
          and(
            eq(s.organizationExportChunk.exportId, row!.id),
            eq(s.organizationExportChunk.attempt, attempt),
            eq(s.organizationExportChunk.sequence, sequence),
          ),
        );
      if (!chunk) return;
      yield new Uint8Array(chunk.data);
    }
  }
  const day = row.createdAt.toISOString().slice(0, 10);
  return {
    filename: `lictory-export-${day}-${row.id.slice(0, 8)}.tar.gz`,
    size: row.size,
    sha256: row.sha256,
    chunks: chunks(),
  };
}

class LeaseLost extends Error {}

// Claims at most one export and builds its archive. Safe to run in several
// workers: the claim uses SKIP LOCKED and a lease, chunks belong to the
// claiming attempt, and only the current attempt may finish the export.
// Interrupted work (a crash, a lost lease) is resumed from the start by the
// next claim; a graceful stop hands it back without spending an attempt.
export async function processOrganizationExports(
  db: Database,
  options: {
    storage?: () => ObjectStorage | null;
    signal?: AbortSignal;
    now?: () => Date;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const expired = await expireExports(db, now());
  const [job] = await db
    .update(s.organizationExport)
    .set({
      status: "running",
      attempt: sql`${s.organizationExport.attempt} + 1`,
      leaseUntil: new Date(now().getTime() + LEASE_MS),
      startedAt: sql`coalesce(${s.organizationExport.startedAt}, now())`,
      error: null,
    })
    .where(
      sql`${s.organizationExport.id} = (
        select id from organization_export
        where (status = 'queued' or (status = 'running'
          and (lease_until is null or lease_until < ${now().toISOString()}::timestamp)))
        order by created_at
        limit 1
        for update skip locked)`,
    )
    .returning();
  if (!job) return { claimed: 0, ready: 0, failed: 0, expired };
  if (job.attempt > MAX_ATTEMPTS) {
    await settle(db, job, {
      status: "failed",
      leaseUntil: null,
      error: `The export did not finish after ${MAX_ATTEMPTS} attempts. Start a new export; if it fails again, check the worker logs.`,
      completedAt: now(),
    });
    return { claimed: 1, ready: 0, failed: 1, expired };
  }
  try {
    await build(db, job, options, now);
    return { claimed: 1, ready: 1, failed: 0, expired };
  } catch (error) {
    if (error instanceof LeaseLost)
      return { claimed: 1, ready: 0, failed: 0, expired };
    await db
      .delete(s.organizationExportChunk)
      .where(
        and(
          eq(s.organizationExportChunk.exportId, job.id),
          eq(s.organizationExportChunk.attempt, job.attempt),
        ),
      );
    if (options.signal?.aborted) {
      // Stopping, not failing: hand the export back for the next worker.
      await settle(db, job, {
        leaseUntil: null,
        attempt: sql`${s.organizationExport.attempt} - 1`,
      });
      return { claimed: 1, ready: 0, failed: 0, expired };
    }
    console.error(
      JSON.stringify({
        event: "export.failed",
        exportId: job.id,
        attempt: job.attempt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const final = job.attempt >= MAX_ATTEMPTS;
    await settle(db, job, {
      ...(final
        ? { status: "failed", completedAt: now(), leaseUntil: null }
        : { leaseUntil: new Date(now().getTime() + RETRY_MS) }),
      error: final
        ? `The export failed after ${MAX_ATTEMPTS} attempts. Start a new export; if it fails again, check the worker logs.`
        : "The last attempt failed; Lictory retries automatically.",
    });
    return { claimed: 1, ready: 0, failed: final ? 1 : 0, expired };
  }
}

// Updates the export only while this attempt still owns it.
function settle(
  db: Database,
  job: ExportRow,
  values: Partial<Record<keyof ExportRow, unknown>>,
) {
  return db
    .update(s.organizationExport)
    .set(values as Partial<typeof s.organizationExport.$inferInsert>)
    .where(
      and(
        eq(s.organizationExport.id, job.id),
        eq(s.organizationExport.attempt, job.attempt),
        eq(s.organizationExport.status, "running"),
      ),
    )
    .returning({ id: s.organizationExport.id });
}

async function build(
  db: Database,
  job: ExportRow,
  options: {
    storage?: () => ObjectStorage | null;
    signal?: AbortSignal;
  },
  now: () => Date,
) {
  // Chunks of an interrupted earlier attempt are never part of this archive.
  await db
    .delete(s.organizationExportChunk)
    .where(
      and(
        eq(s.organizationExportChunk.exportId, job.id),
        ne(s.organizationExportChunk.attempt, job.attempt),
      ),
    );
  let renewed = now().getTime();
  const heartbeat = async (force = false) => {
    if (options.signal?.aborted) throw new Error("The worker is stopping.");
    if (!force && now().getTime() - renewed < HEARTBEAT_MS) return;
    const held = await settle(db, job, {
      leaseUntil: new Date(now().getTime() + LEASE_MS),
    });
    if (!held.length) throw new LeaseLost();
    renewed = now().getTime();
  };
  let sequence = 0;
  const snapshotAt = now();
  const writer = new ArchiveWriter(
    `lictory-export-${job.id.slice(0, 8)}`,
    snapshotAt,
    async (data) => {
      await heartbeat();
      await db.insert(s.organizationExportChunk).values({
        exportId: job.id,
        attempt: job.attempt,
        sequence: sequence++,
        data,
      });
    },
  );
  try {
    await writer.file(
      "format.json",
      Buffer.from(
        `${JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_FORMAT_VERSION }, null, 2)}\n`,
      ),
    );
    const snapshot = await db.transaction(
      (tx) => writeSnapshot(tx, writer, job.organizationId, heartbeat),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    const summary: ExportSummary = {
      ...snapshot,
      attachments: await writeAttachments(
        db,
        writer,
        job.organizationId,
        configuredStorage(options.storage),
        heartbeat,
        options.signal,
      ),
    };
    await writer.file(
      "manifest.json",
      Buffer.from(
        `${JSON.stringify(
          manifest({
            exportId: job.id,
            organizationId: job.organizationId,
            requestedById: job.requestedById,
            snapshotAt,
            summary,
          }),
          null,
          2,
        )}\n`,
      ),
    );
    const { size, sha256 } = await writer.close();
    const done = now();
    const finished = await settle(db, job, {
      status: "ready",
      readyAttempt: job.attempt,
      leaseUntil: null,
      size,
      sha256,
      summary,
      error: null,
      completedAt: done,
      expiresAt: new Date(done.getTime() + EXPORT_RETENTION_DAYS * 86_400_000),
    });
    if (!finished.length) throw new LeaseLost();
  } catch (error) {
    writer.abort();
    throw error;
  }
}

// Attachments are included when the server has file storage.
function configuredStorage(factory?: () => ObjectStorage | null) {
  try {
    return factory ? factory() : null;
  } catch (error) {
    if (error instanceof StorageConfigurationError) return null;
    throw error;
  }
}

// Finished archives are kept for EXPORT_RETENTION_DAYS; failed ones keep no
// bytes. The export rows remain as history.
async function expireExports(db: Database, at: Date) {
  const expired = await db
    .update(s.organizationExport)
    .set({ status: "expired" })
    .where(
      and(
        eq(s.organizationExport.status, "ready"),
        sql`${s.organizationExport.expiresAt} <= ${at.toISOString()}::timestamp`,
      ),
    )
    .returning({ id: s.organizationExport.id });
  await db.execute(sql`
    delete from organization_export_chunk where export_id in (
      select id from organization_export where status in ('expired', 'failed'))`);
  return expired.length;
}
