import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "@lictory/core/db/auth-schema";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// An organization data export requested by an administrator. The row queues
// the work (written with the request, in its transaction); the worker claims
// it with a lease, writes the archive as chunks of the claiming attempt and
// marks it ready. Archives live in the database, so exports work without
// object storage, and expire (chunks deleted) after `expiresAt`.
// See docs/internals/data-export.md.
export const organizationExport = pgTable(
  "organization_export",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Kept as a plain id: the request stays attributable after the account goes.
    requestedById: text("requested_by_id").notNull(),
    // `queued`, `running`, `ready`, `failed` or `expired`.
    status: text("status").notNull().default("queued"),
    // Archive format version (`EXPORT_FORMAT_VERSION`).
    formatVersion: integer("format_version").notNull(),
    // Incremented by every claim; chunks and outcomes are fenced on it.
    attempt: integer("attempt").notNull().default(0),
    leaseUntil: timestamp("lease_until"),
    // The attempt whose chunks are the finished archive.
    readyAttempt: integer("ready_attempt"),
    size: bigint("size", { mode: "number" }),
    sha256: text("sha256"),
    // Rows per entity type and attachment outcome, as in the manifest.
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("organization_export_org_idx").on(t.organizationId, t.createdAt),
    index("organization_export_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    check(
      "organization_export_status",
      sql`${t.status} in ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
  ],
);

// The archive's bytes, in order. Only the chunks of `readyAttempt` form the
// archive; chunks of interrupted attempts are deleted when work resumes.
export const organizationExportChunk = pgTable(
  "organization_export_chunk",
  {
    exportId: text("export_id")
      .notNull()
      .references(() => organizationExport.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    sequence: integer("sequence").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.exportId, t.attempt, t.sequence] })],
);
