import { createHash } from "node:crypto";
import { once } from "node:events";
import { createGzip } from "node:zlib";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import {
  getTableConfig,
  type PgColumn,
  type PgTable,
} from "drizzle-orm/pg-core";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import { csvLine } from "@lictory/core/lib/csv";
import type { ObjectStorage } from "@lictory/core/storage/s3";
import { tarEnd, tarHeader, tarPadding } from "@lictory/core/export/tar";

// The organization export archive: a gzip-compressed tar of JSON Lines (one
// file per entity type, one database row per line), a CSV of work items and
// attachment files. See docs/internals/data-export.md for the format and its
// versioning. Bump the version for any change an importer could misread;
// adding entity files or fields keeps it.
export const EXPORT_FORMAT = "lictory-organization-export";
export const EXPORT_FORMAT_VERSION = 1;

const PAGE = 500;
// Compressed bytes per stored chunk.
const CHUNK = 1024 * 1024;

type Row = Record<string, unknown>;

// Every organization-owned table that is part of the organization's record,
// with the columns that never leave the server. Not exported: projections,
// effective Spaces access and receipts (derived), personal notifications and
// Litto conversations, and credentials (sessions, accounts, access tokens).
const entities: { table: PgTable; omit?: string[] }[] = [
  { table: s.project },
  { table: s.projectMember },
  { table: s.discipline },
  { table: s.disciplineMember },
  { table: s.team },
  { table: s.teamMember },
  { table: s.label },
  { table: s.milestone },
  { table: s.workItemType },
  { table: s.projectWorkItemType },
  { table: s.workflowStatus },
  { table: s.iteration },
  { table: s.iterationEvent },
  { table: s.readinessRevision },
  { table: s.workItem },
  { table: s.workItemLabel },
  { table: s.workItemRelation },
  { table: s.specificationRevision },
  { table: s.specificationCommit },
  { table: s.specificationBranch },
  { table: s.specificationPullRequest },
  { table: s.pullRequestReview },
  { table: s.review },
  { table: s.reviewAssignment },
  { table: s.approval },
  { table: s.readinessSignOff },
  { table: s.readinessCheck },
  { table: s.suggestion },
  { table: s.suggestionReviewer },
  { table: s.suggestionDecision },
  { table: s.thread },
  { table: s.threadMessage },
  { table: s.decision },
  { table: s.activity },
  // Lictory Spaces. Live drafts are exported as the working trees they are
  // (Yjs state, base64), never as published content.
  { table: s.space },
  { table: s.spaceGrant },
  { table: s.page },
  { table: s.pageCommit },
  { table: s.pageBranch },
  { table: s.pageBranchCollaborator },
  { table: s.pagePullRequest },
  { table: s.pagePullRequestReviewer },
  { table: s.pagePullRequestReview },
  { table: s.spaceDraft },
  { table: s.spaceDraftUpdate },
  { table: s.pageThread },
  { table: s.pageThreadMessage },
  { table: s.pageActivity },
  { table: s.fileObject },
  { table: s.deliveryConnection, omit: ["encryptedCredential"] },
  { table: s.deliveryTarget },
  { table: s.workItemExternalLink },
  { table: s.deliveryPublication },
  { table: s.organizationOnboarding },
  { table: s.organizationLogo, omit: ["content"] },
  { table: s.aiRun },
  { table: s.intelligenceContextEntry },
  { table: s.intelligenceContextVersion },
  { table: s.invitation },
  { table: s.configurationAudit },
  { table: s.auditEvent },
  { table: s.capabilityInvocation },
];

export const exportedTables = entities.map((e) => getTableConfig(e.table).name);

const logoExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// Gzip-compresses tar bytes and hands them on in chunks of about 1 MiB, with
// backpressure, so memory stays bounded whatever the organization's size.
export class ArchiveWriter {
  private readonly gzip = createGzip();
  private readonly hash = createHash("sha256");
  private size = 0;
  private failure: unknown = null;
  private readonly done: Promise<void>;

  constructor(
    private readonly root: string,
    private readonly mtime: Date,
    flush: (data: Buffer) => Promise<void>,
  ) {
    this.done = (async () => {
      let pending: Buffer[] = [];
      let pendingSize = 0;
      const emit = async () => {
        const data = Buffer.concat(pending);
        pending = [];
        pendingSize = 0;
        this.hash.update(data);
        this.size += data.length;
        await flush(data);
      };
      for await (const chunk of this.gzip as AsyncIterable<Buffer>) {
        pending.push(chunk);
        pendingSize += chunk.length;
        if (pendingSize >= CHUNK) await emit();
      }
      if (pendingSize) await emit();
    })();
    // A failed flush stops the writer; pending writes then fail too.
    this.done.catch((error: unknown) => {
      this.failure = error;
      this.gzip.destroy(error as Error);
    });
  }

  private async write(bytes: Uint8Array) {
    if (this.failure)
      throw this.failure instanceof Error
        ? this.failure
        : new Error("The export archive could not be written.");
    if (this.gzip.destroyed) throw new Error("The export archive was closed.");
    if (!this.gzip.write(bytes)) await once(this.gzip, "drain");
  }

  // Writes one file whose size is known before its bytes. `produce` must
  // emit exactly `size` bytes.
  async entry(
    name: string,
    size: number,
    produce: (emit: (bytes: Uint8Array) => Promise<void>) => Promise<void>,
  ) {
    await this.write(tarHeader(`${this.root}/${name}`, size, this.mtime));
    let written = 0;
    await produce(async (bytes) => {
      written += bytes.length;
      await this.write(bytes);
    });
    if (written !== size)
      throw new Error(`Archive entry ${name} changed while it was written.`);
    await this.write(tarPadding(size));
  }

  async file(name: string, bytes: Uint8Array) {
    await this.entry(name, bytes.length, (emit) => emit(bytes));
  }

  async close() {
    await this.write(tarEnd());
    this.gzip.end();
    await this.done;
    return { size: this.size, sha256: this.hash.digest("hex") };
  }

  abort() {
    this.gzip.destroy();
  }
}

// Pages through rows in key order, newest page last, `PAGE` rows at a time.
async function* keyset<T>(
  fetch: (after: T | null) => Promise<Row[]>,
  key: (row: Row) => T,
) {
  let after: T | null = null;
  for (;;) {
    const rows = await fetch(after);
    if (rows.length) yield rows;
    if (rows.length < PAGE) return;
    after = key(rows.at(-1)!);
  }
}

function tableRows(
  tx: Tx,
  spec: (typeof entities)[number],
  organizationId: string,
) {
  const columns = getTableColumns(spec.table) as Record<string, PgColumn>;
  const selected = Object.fromEntries(
    Object.entries(columns).filter(([key]) => !spec.omit?.includes(key)),
  );
  const config = getTableConfig(spec.table);
  const primary = config.primaryKeys[0]?.columns ?? [
    ...Object.values(columns).filter((c) => c.primary),
  ];
  const keys = primary.map(
    (column) =>
      Object.entries(columns).find(([, c]) => c.name === column.name)![0],
  );
  return keyset<unknown[]>(
    (after) =>
      tx
        .select(selected)
        .from(spec.table)
        .where(
          and(
            eq(columns.organizationId!, organizationId),
            after
              ? sql`(${sql.join(primary, sql`, `)}) > (${sql.join(
                  after.map((v) => sql`${v}`),
                  sql`, `,
                )})`
              : undefined,
          ),
        )
        .orderBy(...primary.map((c) => asc(c)))
        .limit(PAGE),
    (row) => keys.map((k) => row[k]),
  );
}

function memberRows(tx: Tx, organizationId: string) {
  return keyset<string>(
    (after) =>
      tx
        .select({
          id: s.member.id,
          organizationId: s.member.organizationId,
          userId: s.member.userId,
          role: s.member.role,
          createdAt: s.member.createdAt,
          name: s.user.name,
          email: s.user.email,
          handle: s.user.handle,
        })
        .from(s.member)
        .innerJoin(s.user, eq(s.user.id, s.member.userId))
        .where(
          and(
            eq(s.member.organizationId, organizationId),
            after ? gt(s.member.id, after) : undefined,
          ),
        )
        .orderBy(asc(s.member.id))
        .limit(PAGE),
    (row) => row.id as string,
  );
}

// People who left, by name, so exported history stays attributed. Their
// email is not exported: they are no longer part of the organization.
function formerMemberRows(tx: Tx, organizationId: string) {
  return keyset<string>(
    (after) =>
      tx
        .select({
          organizationId: s.formerMember.organizationId,
          userId: s.formerMember.userId,
          leftAt: s.formerMember.leftAt,
          name: s.user.name,
        })
        .from(s.formerMember)
        .innerJoin(s.user, eq(s.user.id, s.formerMember.userId))
        .where(
          and(
            eq(s.formerMember.organizationId, organizationId),
            after ? gt(s.formerMember.userId, after) : undefined,
          ),
        )
        .orderBy(asc(s.formerMember.userId))
        .limit(PAGE),
    (row) => row.userId as string,
  );
}

const workItemCsvHeader = [
  "Identifier",
  "ID",
  "Project",
  "Type",
  "Title",
  "Status",
  "Status category",
  "Refinement state",
  "Priority",
  "Estimate",
  "Assignee",
  "Team",
  "Iteration",
  "Milestone",
  "Parent",
  "Labels",
  "Created (UTC)",
  "Updated (UTC)",
  "Archived (UTC)",
];

function workItemCsvRows(tx: Tx, organizationId: string) {
  const at = (column: string) =>
    sql.raw(`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
  return keyset<string>(
    async (after) =>
      await tx.execute(sql`
        select w.id, p.key || '-' || w.number as identifier, p.key as project,
          t.name as type, w.title, st.name as status,
          st.category::text as status_category,
          w.refinement_state::text as refinement_state,
          w.priority::text as priority, w.estimate, u.email as assignee,
          tm.name as team, it.name as iteration, ms.name as milestone,
          case when parent.id is null then null
            else pp.key || '-' || parent.number end as parent,
          (select string_agg(l.name, '; ' order by l.name)
            from work_item_label wl join label l on l.id = wl.label_id
            where wl.organization_id = w.organization_id
              and wl.work_item_id = w.id) as labels,
          ${at("w.created_at")} as created, ${at("w.updated_at")} as updated,
          ${at("w.archived_at")} as archived
        from work_item w
        join project p on p.organization_id = w.organization_id
          and p.id = w.project_id
        join work_item_type t on t.id = w.type_id
        join workflow_status st on st.id = w.status_id
        left join "user" u on u.id = w.assignee_id
        left join team tm on tm.id = w.team_id
        left join iteration it on it.id = w.iteration_id
        left join milestone ms on ms.id = w.milestone_id
        left join work_item parent on parent.organization_id = w.organization_id
          and parent.id = w.parent_id
        left join project pp on pp.id = parent.project_id
        where w.organization_id = ${organizationId}
          ${after ? sql`and w.id > ${after}` : sql``}
        order by w.id
        limit ${PAGE}`),
    (row) => row.id as string,
  );
}

const workItemCsvLine = (r: Row) =>
  csvLine(
    [
      "identifier",
      "id",
      "project",
      "type",
      "title",
      "status",
      "status_category",
      "refinement_state",
      "priority",
      "estimate",
      "assignee",
      "team",
      "iteration",
      "milestone",
      "parent",
      "labels",
      "created",
      "updated",
      "archived",
    ].map((k) => r[k] as string | number | null),
  );

export type ExportSummary = {
  entities: Record<string, { file: string; rows: number }>;
  workItemsCsv: { file: string; rows: number };
  logos: string[];
  attachments:
    | { included: true; files: number; missing: string[] }
    | { included: false; reason: string };
};

// Writes a file in two passes over the same snapshot: the first measures
// its size (a tar header needs it up front), the second writes it. Pages are
// read again rather than held in memory.
async function twoPass(
  writer: ArchiveWriter,
  name: string,
  header: string,
  pages: () => AsyncGenerator<Row[]>,
  line: (row: Row) => string,
  heartbeat: () => Promise<void>,
) {
  let size = Buffer.byteLength(header);
  let rows = 0;
  for await (const page of pages()) {
    for (const row of page) size += Buffer.byteLength(line(row));
    rows += page.length;
    await heartbeat();
  }
  await writer.entry(name, size, async (emit) => {
    if (header) await emit(Buffer.from(header));
    for await (const page of pages()) {
      await emit(Buffer.from(page.map(line).join("")));
      await heartbeat();
    }
  });
  return rows;
}

// Binary columns (live draft Yjs state) are base64 strings.
const jsonLine = (row: Row) =>
  `${JSON.stringify(
    Object.values(row).some((v) => v instanceof Uint8Array)
      ? Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v,
          ]),
        )
      : row,
  )}\n`;

// Everything read from the database, from one consistent snapshot `tx`
// (REPEATABLE READ): the organization, members and every entity type, the
// work item CSV and the logos.
export async function writeSnapshot(
  tx: Tx,
  writer: ArchiveWriter,
  organizationId: string,
  heartbeat: () => Promise<void>,
): Promise<Omit<ExportSummary, "attachments">> {
  const [organization] = await tx
    .select({
      id: s.organization.id,
      name: s.organization.name,
      slug: s.organization.slug,
      createdAt: s.organization.createdAt,
    })
    .from(s.organization)
    .where(eq(s.organization.id, organizationId));
  if (!organization) throw new Error("The organization no longer exists.");
  await writer.file(
    "organization.json",
    Buffer.from(`${JSON.stringify(organization, null, 2)}\n`),
  );

  const summary: Omit<ExportSummary, "attachments"> = {
    entities: {},
    workItemsCsv: { file: "work-items.csv", rows: 0 },
    logos: [],
  };
  const file = "entities/member.jsonl";
  summary.entities.member = {
    file,
    rows: await twoPass(
      writer,
      file,
      "",
      () => memberRows(tx, organizationId),
      jsonLine,
      heartbeat,
    ),
  };
  const formerFile = "entities/former_member.jsonl";
  summary.entities.former_member = {
    file: formerFile,
    rows: await twoPass(
      writer,
      formerFile,
      "",
      () => formerMemberRows(tx, organizationId),
      jsonLine,
      heartbeat,
    ),
  };
  for (const spec of entities) {
    const name = getTableConfig(spec.table).name;
    const path = `entities/${name}.jsonl`;
    summary.entities[name] = {
      file: path,
      rows: await twoPass(
        writer,
        path,
        "",
        () => tableRows(tx, spec, organizationId),
        jsonLine,
        heartbeat,
      ),
    };
  }
  summary.workItemsCsv.rows = await twoPass(
    writer,
    summary.workItemsCsv.file,
    csvLine(workItemCsvHeader),
    () => workItemCsvRows(tx, organizationId),
    workItemCsvLine,
    heartbeat,
  );
  const logos = await tx
    .select()
    .from(s.organizationLogo)
    .where(eq(s.organizationLogo.organizationId, organizationId));
  for (const logo of logos) {
    const path = `organization/logo-${logo.kind}.${logoExtensions[logo.mimeType] ?? "bin"}`;
    await writer.file(path, logo.content);
    summary.logos.push(path);
  }
  return summary;
}

// Attachment bytes come from object storage, outside any database
// transaction. Files that cannot be read are listed as missing rather than
// failing the export; without storage the manifest says so.
export async function writeAttachments(
  db: Database,
  writer: ArchiveWriter,
  organizationId: string,
  storage: ObjectStorage | null,
  heartbeat: () => Promise<void>,
  signal?: AbortSignal,
): Promise<ExportSummary["attachments"]> {
  if (!storage)
    return {
      included: false,
      reason: "No file storage is configured on this server.",
    };
  const missing: string[] = [];
  let files = 0;
  const pages = keyset<string>(
    (after) =>
      db
        .select({
          id: s.fileObject.id,
          objectKey: s.fileObject.objectKey,
          filename: s.fileObject.filename,
          mimeType: s.fileObject.mimeType,
        })
        .from(s.fileObject)
        .where(
          and(
            eq(s.fileObject.organizationId, organizationId),
            isNotNull(s.fileObject.readyAt),
            isNull(s.fileObject.removedAt),
            after ? gt(s.fileObject.id, after) : undefined,
          ),
        )
        .orderBy(asc(s.fileObject.id))
        .limit(PAGE),
    (row) => row.id as string,
  );
  for await (const page of pages)
    for (const file of page as {
      id: string;
      objectKey: string;
      filename: string;
      mimeType: string;
    }[]) {
      await heartbeat();
      let bytes: Buffer | null = null;
      try {
        const url = await storage.presignDownload(
          file.objectKey,
          file.filename,
          file.mimeType,
          false,
        );
        const response = await fetch(url, { signal });
        if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      if (!bytes) {
        missing.push(file.id);
        continue;
      }
      await writer.file(`attachments/${file.id}`, bytes);
      files++;
    }
  return { included: true, files, missing };
}

export function manifest(input: {
  exportId: string;
  organizationId: string;
  requestedById: string;
  snapshotAt: Date;
  summary: ExportSummary;
}) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exportId: input.exportId,
    organizationId: input.organizationId,
    requestedById: input.requestedById,
    snapshotAt: input.snapshotAt.toISOString(),
    ...input.summary,
  };
}
