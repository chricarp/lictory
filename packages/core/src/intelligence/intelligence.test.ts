import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { directory } from "@lictory/core/domain/service";
import {
  projectionDrift,
  projectionService,
} from "@lictory/core/domain/projection-reader.test-helper";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  PROTOCOL,
  pageSchema,
  type Command,
} from "@lictory/core/contracts/protocol";
import type { Analyzer, ItemReviewOutput } from "@lictory/core/ai/analyzer";
import type { ItemReviewContext } from "@lictory/core/ai/context";
import { processAiRuns } from "@lictory/core/ai/runner";
import { composeIntelligenceContext } from "@lictory/core/intelligence/compose";
import {
  ConversionError,
  convertDocument,
} from "@lictory/core/intelligence/convert";
import {
  createIntelligenceContext,
  intelligenceContextHistory,
  listIntelligenceContext,
  reviseIntelligenceContext,
  setIntelligenceContextArchived,
} from "@lictory/core/intelligence/server";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_context_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const service = projectionService(db);
const previousKey = process.env.OPENAI_API_KEY;
let created = false;
before(async () => {
  process.env.OPENAI_API_KEY = "test-key";
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  process.env.OPENAI_API_KEY = previousKey;
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function fixture() {
  const organizationId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: adminId, name: "Admin", email: `${adminId}@example.test` },
    { id: memberId, name: "Member", email: `${memberId}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: adminId,
      role: "owner",
      createdAt: new Date(),
    },
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: memberId,
      role: "member",
      createdAt: new Date(),
    },
  ]);
  await seedOrganization(db, organizationId);
  const command = (c: Command, actor = adminId) =>
    service.mutate(actor, {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: c,
    });
  const projectId = crypto.randomUUID();
  const otherProjectId = crypto.randomUUID();
  await command({
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  await command({
    type: "createProject",
    projectId: otherProjectId,
    name: "Search",
    key: "SRC",
  });
  const teamId = crypto.randomUUID();
  await command({ type: "createTeam", projectId, teamId, name: "Checkout" });
  const dir = await directory(db, adminId, organizationId);
  const storyType = dir.types.find((t) => t.name === "Story")!.id;
  const storyId = crypto.randomUUID();
  await command({
    type: "createWorkItem",
    projectId,
    workItemId: storyId,
    typeId: storyType,
    teamId,
    parentId: null,
    title: "Retry after timeout",
    description: "Retry the payment when the provider times out.",
  });
  const note = (
    target: Parameters<typeof createIntelligenceContext>[3],
    title: string,
    content: string,
    actor = adminId,
  ) =>
    createIntelligenceContext(db, organizationId, actor, target, {
      title,
      content,
    });
  const runs = async () =>
    pageSchema
      .parse(
        await service.read(adminId, {
          organizationId,
          projectId,
          workItemId: storyId,
        }),
      )
      .changes.flatMap((c) =>
        c.operation === "upsert" && c.entity.type === "aiRun" ? [c.entity] : [],
      );
  return {
    organizationId,
    adminId,
    memberId,
    projectId,
    otherProjectId,
    teamId,
    storyId,
    command,
    note,
    runs,
  };
}

const compose = (f: Awaited<ReturnType<typeof fixture>>, budget?: number) =>
  db.transaction((tx) =>
    composeIntelligenceContext(
      tx,
      f.organizationId,
      { projectId: f.projectId, teamId: f.teamId },
      budget,
    ),
  );

void test("only administrators change context; every member can read it", async () => {
  const f = await fixture();
  await assert.rejects(
    f.note({ scope: "organization" }, "Glossary", "A charge is…", f.memberId),
    /Only organization administrators/,
  );
  const { id } = await f.note(
    { scope: "organization" },
    "Glossary",
    "A **charge** moves money from a customer.",
  );
  const listed = await listIntelligenceContext(
    db,
    f.organizationId,
    f.memberId,
  );
  assert.equal(listed.canManage, false);
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0]!.current.title, "Glossary");
  await assert.rejects(
    setIntelligenceContextArchived(db, f.organizationId, f.memberId, id, true),
    /Only organization administrators/,
  );
  await assert.rejects(
    reviseIntelligenceContext(db, f.organizationId, f.memberId, id, {
      title: "Glossary",
      content: "Changed",
    }),
    /Only organization administrators/,
  );
});

void test("context never crosses organizations", async () => {
  const a = await fixture();
  const b = await fixture();
  // A project id from another organization is not a valid target.
  await assert.rejects(
    a.note({ scope: "project", projectId: b.projectId }, "Leak", "x"),
    /no longer exists/,
  );
  const { id } = await a.note({ scope: "organization" }, "Secret", "A only");
  assert.equal(
    (await listIntelligenceContext(db, b.organizationId, b.adminId)).entries
      .length,
    0,
  );
  await assert.rejects(
    intelligenceContextHistory(db, b.organizationId, b.adminId, id),
    /no longer exists/,
  );
  await assert.rejects(
    setIntelligenceContextArchived(db, b.organizationId, b.adminId, id, true),
    /no longer exists/,
  );
  // Not a member of A at all.
  await assert.rejects(
    listIntelligenceContext(db, a.organizationId, b.adminId),
    /access has been removed/,
  );
  assert.equal((await compose(b)).entries.length, 0);
});

void test("edits create versions and never rewrite earlier ones", async () => {
  const f = await fixture();
  const { id } = await f.note(
    { scope: "project", projectId: f.projectId },
    "Payment rules",
    "Refunds take 5 days.",
  );
  const [first] = await intelligenceContextHistory(
    db,
    f.organizationId,
    f.memberId,
    id,
  );
  await assert.rejects(
    reviseIntelligenceContext(db, f.organizationId, f.adminId, id, {
      title: "Payment rules",
      content: "Refunds take 5 days.",
    }),
    /no changes/,
  );
  const revised = await reviseIntelligenceContext(
    db,
    f.organizationId,
    f.adminId,
    id,
    { title: "Payment rules", content: "Refunds take 3 business days." },
  );
  assert.equal(revised.number, 2);
  const history = await intelligenceContextHistory(
    db,
    f.organizationId,
    f.memberId,
    id,
  );
  assert.deepEqual(
    history.map((v) => [v.number, v.content]),
    [
      [2, "Refunds take 3 business days."],
      [1, "Refunds take 5 days."],
    ],
  );
  assert.deepEqual(history[1], first);
  // Notes cannot be replaced by an uploaded file.
  await assert.rejects(
    reviseIntelligenceContext(db, f.organizationId, f.adminId, id, {
      title: "Payment rules",
      document: {
        ...(await convertDocument("rules.md", new TextEncoder().encode("# R"))),
        filename: "rules.md",
      },
    }),
    /Only document entries/,
  );
});

void test("scopes compound for the work's project and team, narrowest kept first", async () => {
  const f = await fixture();
  await f.note({ scope: "organization" }, "Org", "o".repeat(3_000));
  await f.note(
    { scope: "project", projectId: f.projectId },
    "Proj",
    "p".repeat(3_000),
  );
  await f.note({ scope: "team", teamId: f.teamId }, "Team", "t".repeat(3_000));
  await f.note(
    { scope: "project", projectId: f.otherProjectId },
    "Other project",
    "never included",
  );
  const all = await compose(f);
  // Broad to narrow in the prompt, with stable refs.
  assert.deepEqual(
    all.entries.map((e) => [e.ref, e.scope, e.title]),
    [
      ["C1", "organization", "Org"],
      ["C2", "project", "Proj"],
      ["C3", "team", "Team"],
    ],
  );
  assert.equal(all.entries[1]!.scopeName, "Payments");
  // Budget for two entries and a slice: the organization's is trimmed.
  const tight = await compose(f, 6_800);
  assert.equal(tight.entries[0]!.title, "Org");
  assert.equal(tight.uses.get("C1")!.truncated, true);
  assert.equal(tight.uses.get("C3")!.truncated, false);
  // Too little left for a useful slice: the organization's is left out.
  const tighter = await compose(f, 6_200);
  assert.deepEqual(
    tighter.entries.map((e) => e.scope),
    ["project", "team"],
  );
  assert.equal(tighter.omitted, 1);
});

void test("archived context stops reaching Lictory Intelligence and can be restored", async () => {
  const f = await fixture();
  const { id } = await f.note({ scope: "organization" }, "Policy", "Be safe.");
  await setIntelligenceContextArchived(
    db,
    f.organizationId,
    f.adminId,
    id,
    true,
  );
  assert.equal((await compose(f)).entries.length, 0);
  await assert.rejects(
    reviseIntelligenceContext(db, f.organizationId, f.adminId, id, {
      title: "Policy",
      content: "Changed",
    }),
    /Restore this entry/,
  );
  await setIntelligenceContextArchived(
    db,
    f.organizationId,
    f.adminId,
    id,
    false,
  );
  assert.equal((await compose(f)).entries[0]!.title, "Policy");
});

void test("Lictory Intelligence reviews receive the context, cite it, and record the versions used", async () => {
  const f = await fixture();
  await f.note(
    { scope: "organization" },
    "Payments policy",
    "Every payment retry reuses the original idempotency key.",
  );
  const team = await f.note(
    { scope: "team", teamId: f.teamId },
    "Team conventions",
    "Stories need a timeout acceptance criterion.",
  );
  await f.command({ type: "setAiPolicy", enabled: true });
  await f.command({
    type: "requestAiReview",
    workItemId: f.storyId,
    runId: crypto.randomUUID(),
  });
  let received: ItemReviewContext | undefined;
  const analyzer: Analyzer = {
    model: "fake",
    async reviewItem(context) {
      received = context;
      const finding: ItemReviewOutput["findings"][number] = {
        itemKey: "PAY-1",
        kind: "validation",
        category: "failure_behavior",
        severity: "major",
        title: "Retries do not reuse the idempotency key",
        detail: "The payments policy requires it.",
        evidence: [],
        question: null,
        recommendation: null,
        edit: null,
        // C9 was never provided and must not survive.
        contextRefs: ["c1", "C9", "C1"],
      };
      return { summary: "Gaps.", strengths: [], findings: [finding] };
    },
    async reviewPullRequest() {
      throw new Error("not used");
    },
  };
  assert.equal((await processAiRuns(db, { analyzer })).completed, 1);
  assert.deepEqual(
    received?.intelligenceContext?.entries.map((e) => e.title),
    ["Payments policy", "Team conventions"],
  );
  const [run] = await f.runs();
  assert.deepEqual(
    run!.intelligenceContext.map((u) => [u.scope, u.title, u.version]),
    [
      ["organization", "Payments policy", 1],
      ["team", "Team conventions", 1],
    ],
  );
  assert.deepEqual(
    run!.findings[0]!.context.map((c) => c.title),
    ["Payments policy"],
  );
  // The run keeps naming the version it used after the entry changes.
  await reviseIntelligenceContext(db, f.organizationId, f.adminId, team.id, {
    title: "Team conventions",
    content: "Stories need timeout and retry criteria.",
  });
  const [after] = await f.runs();
  assert.equal(after!.intelligenceContext[1]!.version, 1);
  const stored = await db.select().from(s.aiRun).where(eq(s.aiRun.id, run!.id));
  assert.equal(stored[0]!.intelligenceContext.length, 2);
});

void test("documents convert locally to Markdown; unsupported files are rejected", async () => {
  const csv = await convertDocument(
    "limits.csv",
    new TextEncoder().encode("currency,limit\nEUR,1000\n"),
  );
  assert.equal(csv.format, "csv");
  assert.match(csv.markdown, /\| currency \| limit \|/);
  assert.equal(csv.sha256.length, 64);
  const md = await convertDocument(
    "notes.md",
    new TextEncoder().encode("# Notes\r\n\r\nKeep it.\r\n"),
  );
  assert.equal(md.markdown, "# Notes\n\nKeep it.");
  await assert.rejects(
    convertDocument("tool.exe", new Uint8Array([1, 2, 3])),
    ConversionError,
  );
  await assert.rejects(
    convertDocument("fake.pdf", new TextEncoder().encode("not a pdf")),
    ConversionError,
  );
  await assert.rejects(
    convertDocument("../x.md", new TextEncoder().encode("x")),
    /without paths/,
  );
});

void test("projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});
