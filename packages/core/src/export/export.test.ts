import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { readAuditLog } from "@lictory/core/domain/audit-log";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
} from "@lictory/core/export/archive";
import {
  listOrganizationExports,
  openOrganizationExport,
  processOrganizationExports,
  requestOrganizationExport,
} from "@lictory/core/export/service";
import { tarHeader } from "@lictory/core/export/tar";
import { invoke } from "@lictory/core/capabilities/registry";
import { CapabilityError, noEffects } from "@lictory/core/capabilities/core";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_export_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

// An organization with one project and a spec-backed Story whose second
// revision an Engineering reviewer approved.
async function workspace(title: string, key = "PAY") {
  const owner = await user("Owner");
  const reviewer = await user("Reviewer");
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: `${title} org`,
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    (
      [
        [owner, "owner"],
        [reviewer, "member"],
      ] as const
    ).map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const command = (command: Command, actor = owner) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const projectId = crypto.randomUUID();
  await command({ type: "createProject", projectId, name: title, key });
  const roster = await directory(db, owner, organizationId);
  const engineering = roster.disciplines.find((d) => d.name === "Engineering")!;
  await command({
    type: "setDisciplineMember",
    projectId,
    disciplineId: engineering.id,
    userId: reviewer,
    member: true,
  });
  const [story] = await db
    .select({ id: s.workItemType.id })
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, organizationId),
        eq(s.workItemType.name, "Story"),
      ),
    );
  const workItemId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: story!.id,
    parentId: null,
    title,
    description: "# Behavior\n\nRetries reuse the transaction ID.",
  });
  const revisions = () =>
    db
      .select({ id: s.specificationRevision.id })
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, workItemId))
      .orderBy(asc(s.specificationRevision.createdAt));
  const [first] = await revisions();
  await command({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: first!.id,
    title,
    content: "# Behavior\n\nRetries reuse the original transaction ID.",
  });
  const second = (await revisions()).at(-1)!;
  const reviewId = crypto.randomUUID();
  await command({
    type: "requestReview",
    workItemId,
    baseRevisionId: second.id,
    reviewId,
    disciplineId: engineering.id,
    userId: reviewer,
    required: true,
  });
  await command(
    {
      type: "decideReview",
      workItemId,
      baseRevisionId: second.id,
      reviewId,
      decision: "approve",
    },
    reviewer,
  );
  // A space with one page (its main line has a live draft).
  const spaceId = crypto.randomUUID();
  await command({
    type: "createSpace",
    spaceId,
    name: `${title} handbook`,
    slug: "handbook",
    home: { projectId },
  });
  const pageId = crypto.randomUUID();
  await command({
    type: "createPage",
    spaceId,
    pageId,
    title: `${title} notes`,
  });
  await db
    .update(s.spaceDraft)
    .set({ snapshot: Buffer.from([1, 2, 3]) })
    .where(eq(s.spaceDraft.pageId, pageId));
  return {
    owner,
    reviewer,
    organizationId,
    workItemId,
    spaceId,
    pageId,
    revisionIds: (await revisions()).map((r) => r.id),
  };
}

function untar(archive: Buffer) {
  const files = new Map<string, Buffer>();
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(header.subarray(124, 136).toString("ascii"), 8);
    files.set(
      name.replace(/^[^/]+\//, ""),
      tar.subarray(offset + 512, offset + 512 + size),
    );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function download(userId: string, organizationId: string, id: string) {
  const archive = await openOrganizationExport(db, userId, organizationId, id);
  const parts: Uint8Array[] = [];
  for await (const chunk of archive.chunks) parts.push(chunk);
  const bytes = Buffer.concat(parts);
  assert.equal(bytes.length, archive.size);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    archive.sha256,
  );
  return untar(bytes);
}

const jsonl = (files: Map<string, Buffer>, name: string) =>
  files
    .get(`entities/${name}.jsonl`)!
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

void test(
  "an export holds every revision and each approval with the revision it approved, and nothing of other organizations",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Retry payments");
    const foreign = await workspace("Foreign launch plans", "FOR");

    const requested = await requestOrganizationExport(
      db,
      w.owner,
      w.organizationId,
    );
    // One export at a time: asking again returns the queued one.
    const again = await requestOrganizationExport(
      db,
      w.owner,
      w.organizationId,
    );
    assert.equal(again.existing, true);
    assert.equal(again.export.id, requested.export.id);

    const result = await processOrganizationExports(db, {
      storage: () => null,
    });
    assert.equal(result.ready, 1);
    const [listed] = (
      await listOrganizationExports(db, w.owner, w.organizationId)
    ).exports;
    assert.equal(listed?.status, "ready");

    const files = await download(
      w.owner,
      w.organizationId,
      requested.export.id,
    );
    assert.deepEqual(JSON.parse(files.get("format.json")!.toString()), {
      format: EXPORT_FORMAT,
      version: EXPORT_FORMAT_VERSION,
    });
    const revisions = jsonl(files, "specification_revision");
    assert.deepEqual(
      revisions
        .filter((r) => r.workItemId === w.workItemId)
        .map((r) => r.id)
        .sort(),
      [...w.revisionIds].sort(),
    );
    assert.ok(
      revisions.some((r) =>
        String(r.content).includes(
          "Retries reuse the original transaction ID.",
        ),
      ),
    );
    const approvals = jsonl(files, "approval");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]!.revisionId, w.revisionIds.at(-1));
    assert.equal(approvals[0]!.status, "granted");
    assert.ok(revisions.some((r) => r.id === approvals[0]!.revisionId));
    assert.equal(jsonl(files, "review").length >= 1, true);
    const members = jsonl(files, "member");
    assert.deepEqual(
      members.map((m) => m.userId).sort(),
      [w.owner, w.reviewer].sort(),
    );

    // Spaces: the space, its page and the page's history, and the live
    // draft as a working tree (binary state in base64).
    assert.deepEqual(
      jsonl(files, "space").map((x) => x.id),
      [w.spaceId],
    );
    assert.deepEqual(
      jsonl(files, "page").map((x) => x.id),
      [w.pageId],
    );
    assert.deepEqual(
      jsonl(files, "page_commit").map((x) => x.title),
      ["Retry payments notes"],
    );
    assert.equal(jsonl(files, "page_branch")[0]?.name, "main");
    assert.equal(jsonl(files, "space_draft")[0]?.snapshot, "AQID");

    const csv = files.get("work-items.csv")!.toString("utf8");
    assert.match(csv.split("\r\n")[0]!, /^Identifier,ID,Project,Type,Title/);
    assert.ok(csv.includes("PAY-1,"));
    assert.ok(csv.includes("Retry payments"));

    const manifest = JSON.parse(files.get("manifest.json")!.toString()) as {
      organizationId: string;
      entities: Record<string, { rows: number }>;
      attachments: { included: boolean };
    };
    assert.equal(manifest.organizationId, w.organizationId);
    assert.equal(
      manifest.entities.specification_revision!.rows,
      revisions.length,
    );
    assert.equal(manifest.attachments.included, false);

    // Tenant isolation: nothing of the other organization, no credentials.
    const everything = [...files.values()]
      .map((b) => b.toString("utf8"))
      .join("\n");
    assert.ok(!everything.includes(foreign.organizationId));
    assert.ok(!everything.includes("Foreign launch plans"));
    assert.ok(!everything.includes(foreign.workItemId));
    assert.ok(!everything.includes("encryptedCredential"));

    // Requesting and downloading are audited.
    const audit = await readAuditLog(db, w.owner, w.organizationId, {
      category: "organization",
    });
    assert.deepEqual(
      audit.entries
        .map((e) => e.action)
        .filter((a) => a.startsWith("data_export")),
      ["data_export.downloaded", "data_export.requested"],
    );
  },
);

void test(
  "only administrators of the organization request, list and download exports",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Authorization");
    const other = await workspace("Elsewhere", "ELS");
    const { export: requested } = await requestOrganizationExport(
      db,
      w.owner,
      w.organizationId,
    );
    await processOrganizationExports(db, { storage: () => null });
    const forbidden = (e: unknown) =>
      e instanceof DomainError && e.category === "forbidden";
    for (const [userId, organizationId] of [
      [w.reviewer, w.organizationId],
      [other.owner, w.organizationId],
    ] as const) {
      await assert.rejects(
        requestOrganizationExport(db, userId, organizationId),
        forbidden,
      );
      await assert.rejects(
        listOrganizationExports(db, userId, organizationId),
        forbidden,
      );
      await assert.rejects(
        openOrganizationExport(db, userId, organizationId, requested.id),
        forbidden,
      );
    }
    // An administrator of another organization cannot reach it through theirs.
    await assert.rejects(
      openOrganizationExport(
        db,
        other.owner,
        other.organizationId,
        requested.id,
      ),
      (e: unknown) => e instanceof DomainError && e.category === "not_found",
    );
    // Agents cannot start exports.
    await assert.rejects(
      invoke(
        {
          db,
          principal: { userId: w.owner, surface: "mcp" },
          effects: noEffects,
        },
        "requestOrganizationExport",
        { organizationId: w.organizationId },
      ),
      (e: unknown) =>
        e instanceof CapabilityError && e.details.kind === "human_only",
    );
  },
);

void test(
  "an interrupted export is rebuilt by the next claim, and finished archives expire",
  { timeout: 60_000 },
  async () => {
    const w = await workspace("Recovery");
    const { export: requested } = await requestOrganizationExport(
      db,
      w.owner,
      w.organizationId,
    );
    // A worker claimed it, wrote part of an archive and died.
    await db
      .update(s.organizationExport)
      .set({
        status: "running",
        attempt: 1,
        leaseUntil: new Date(Date.now() - 1_000),
      })
      .where(eq(s.organizationExport.id, requested.id));
    await db.insert(s.organizationExportChunk).values({
      exportId: requested.id,
      attempt: 1,
      sequence: 0,
      data: Buffer.from("partial"),
    });
    assert.equal(
      (await processOrganizationExports(db, { storage: () => null })).ready,
      1,
    );
    const [row] = await db
      .select()
      .from(s.organizationExport)
      .where(eq(s.organizationExport.id, requested.id));
    assert.equal(row!.readyAttempt, 2);
    const stale = await db
      .select()
      .from(s.organizationExportChunk)
      .where(
        and(
          eq(s.organizationExportChunk.exportId, requested.id),
          eq(s.organizationExportChunk.attempt, 1),
        ),
      );
    assert.equal(stale.length, 0);
    assert.ok(
      (await download(w.owner, w.organizationId, requested.id)).has(
        "manifest.json",
      ),
    );

    // Nothing is left to claim.
    assert.equal(
      (await processOrganizationExports(db, { storage: () => null })).claimed,
      0,
    );

    const later = new Date(Date.now() + 8 * 86_400_000);
    const expired = await processOrganizationExports(db, {
      storage: () => null,
      now: () => later,
    });
    assert.equal(expired.expired >= 1, true);
    const chunks = await db
      .select()
      .from(s.organizationExportChunk)
      .where(eq(s.organizationExportChunk.exportId, requested.id));
    assert.equal(chunks.length, 0);
    await assert.rejects(
      openOrganizationExport(db, w.owner, w.organizationId, requested.id),
      /expired/,
    );
  },
);

void test("tar headers are valid ustar headers", () => {
  const header = tarHeader("export/manifest.json", 1234, new Date(0));
  assert.equal(header.length, 512);
  assert.equal(header.subarray(257, 262).toString("ascii"), "ustar");
  assert.equal(parseInt(header.subarray(124, 136).toString("ascii"), 8), 1234);
  let sum = 0;
  for (const [i, byte] of header.entries())
    sum += i >= 148 && i < 156 ? 0x20 : byte;
  assert.equal(parseInt(header.subarray(148, 156).toString("ascii"), 8), sum);
  assert.throws(() => tarHeader("x".repeat(101), 1, new Date()), /too long/);
});
