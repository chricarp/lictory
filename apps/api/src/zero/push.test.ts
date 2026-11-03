import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { createZeroEndpoints } from "@lictory/api/zero/server";

// The browser write path end to end, minus the network: Zero's real
// `handleMutateRequest` runs the server mutators against a disposable
// database, with the upstream bookkeeping tables zero-cache would create.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_push_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
const committed: string[] = [];
const zero = createZeroEndpoints(db, {
  onCommitted: (outcome) => committed.push(outcome.mutation.id),
});

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  // The shard tables zero-cache creates upstream (app "zero", shard 0).
  await client.unsafe(`
    CREATE SCHEMA zero_0;
    CREATE TABLE zero_0.clients (
      "clientGroupID" TEXT NOT NULL,
      "clientID" TEXT NOT NULL,
      "lastMutationID" BIGINT NOT NULL,
      "userID" TEXT,
      PRIMARY KEY ("clientGroupID", "clientID")
    );
    CREATE TABLE zero_0.mutations (
      "clientGroupID" TEXT NOT NULL,
      "clientID" TEXT NOT NULL,
      "mutationID" BIGINT NOT NULL,
      "result" JSON NOT NULL,
      PRIMARY KEY ("clientGroupID", "clientID", "mutationID")
    );`);
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function fixture() {
  const organizationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await db.insert(s.user).values([
    { id: ownerId, name: "Owner", email: `${ownerId}@example.test` },
    { id: memberId, name: "Member", email: `${memberId}@example.test` },
  ]);
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Push",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values([
    {
      id: crypto.randomUUID(),
      organizationId,
      userId: ownerId,
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
  const clientGroupID = crypto.randomUUID();
  const clientID = crypto.randomUUID();
  let next = 0;
  const mutation = (command: Command, id: string = crypto.randomUUID()) => ({
    protocol: PROTOCOL,
    id,
    organizationId,
    command,
  });
  // One push request carrying one custom mutation, as zero-cache sends it.
  const push = async (
    userID: string,
    args: ReturnType<typeof mutation>,
    mutationID = ++next,
  ) => {
    const request = new Request(
      "http://api.test/api/zero/mutate?schema=zero_0&appID=zero",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientGroupID,
          pushVersion: 1,
          timestamp: Date.now(),
          requestID: crypto.randomUUID(),
          mutations: [
            {
              type: "custom",
              id: mutationID,
              clientID,
              name: "workspace.apply",
              args: [args],
              timestamp: Date.now(),
            },
          ],
        }),
      },
    );
    const response = (await zero.mutate(request, userID)) as {
      mutations: { result: Record<string, unknown> }[];
    };
    return response.mutations[0]!.result;
  };
  const lastMutationID = async () =>
    Number(
      (
        await client`select "lastMutationID" from zero_0.clients where "clientGroupID" = ${clientGroupID} and "clientID" = ${clientID}`
      )[0]?.lastMutationID ?? 0,
    );
  const results = () =>
    client`select "mutationID", result from zero_0.mutations where "clientGroupID" = ${clientGroupID} order by "mutationID"`;
  const projections = async () =>
    (
      await db
        .select({ key: s.syncEntity.key })
        .from(s.syncEntity)
        .where(eq(s.syncEntity.organizationId, organizationId))
    )
      .map((r) => r.key)
      .sort();
  return {
    organizationId,
    ownerId,
    memberId,
    mutation,
    push,
    lastMutationID,
    results,
    projections,
  };
}

const createProject = (projectId = crypto.randomUUID()): Command => ({
  type: "createProject",
  projectId,
  name: "Payments",
  key: "PAY",
});

void test("a pushed command commits domain rows, projections, the receipt and Zero's client state together", async () => {
  const f = await fixture();
  const projectId = crypto.randomUUID();
  const args = f.mutation(createProject(projectId));
  assert.deepEqual(await f.push(f.ownerId, args), {});
  assert.equal(await f.lastMutationID(), 1);
  const [project] = await db
    .select()
    .from(s.project)
    .where(eq(s.project.id, projectId));
  assert.equal(project?.organizationId, f.organizationId);
  assert.ok((await f.projections()).includes(`project:${projectId}`));
  const [directory] = await db
    .select()
    .from(s.syncEntity)
    .where(eq(s.syncEntity.key, `directory:${f.organizationId}`));
  assert.ok(
    (directory!.data.projects as { id: string }[]).some(
      (p) => p.id === projectId,
    ),
  );
  const receipts = await db
    .select()
    .from(s.syncMutation)
    .where(eq(s.syncMutation.id, args.id));
  assert.equal(receipts.length, 1);
  assert.ok(committed.includes(args.id));
});

void test("a domain rejection is an application error with details and writes nothing but Zero's bookkeeping", async () => {
  const f = await fixture();
  const before = await f.projections();
  const args = f.mutation(createProject());
  const result = await f.push(f.memberId, args);
  assert.equal(result.error, "app");
  assert.equal(
    result.message,
    "An organization administrator must create projects.",
  );
  assert.deepEqual(result.details, {
    category: "forbidden",
    message: "An organization administrator must create projects.",
  });
  // The mutation is consumed (it will not be resent) and its error recorded.
  assert.equal(await f.lastMutationID(), 1);
  assert.equal((await f.results()).length, 1);
  assert.deepEqual(await f.projections(), before);
  assert.equal(
    (
      await db
        .select()
        .from(s.project)
        .where(eq(s.project.organizationId, f.organizationId))
    ).length,
    0,
  );
  assert.equal(
    (
      await db
        .select()
        .from(s.syncMutation)
        .where(eq(s.syncMutation.id, args.id))
    ).length,
    0,
  );
  assert.ok(!committed.includes(args.id));

  // Stale revisions carry the current revision for the client to rebase on.
  const projectId = crypto.randomUUID();
  await f.push(f.ownerId, f.mutation(createProject(projectId)));
  const types = await db
    .select()
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, f.organizationId),
        eq(s.workItemType.name, "Story"),
      ),
    );
  const workItemId = crypto.randomUUID();
  await f.push(
    f.ownerId,
    f.mutation({
      type: "createWorkItem",
      projectId,
      workItemId,
      typeId: types[0]!.id,
      parentId: null,
      title: "Safe retries",
      description: "Draft",
    }),
  );
  const stale = await f.push(
    f.ownerId,
    f.mutation({
      type: "updateSpecification",
      workItemId,
      baseRevisionId: crypto.randomUUID(),
      title: "Safe retries",
      content: "Changed",
    }),
  );
  assert.equal(stale.error, "app");
  const details = stale.details as Record<string, unknown>;
  assert.equal(details.category, "conflict");
  assert.equal(typeof details.currentRevisionId, "string");
  // Malformed arguments are validation errors with issues, not crashes.
  const malformed = await f.push(f.ownerId, {
    ...f.mutation(createProject()),
    command: { type: "createProject" } as unknown as Command,
  });
  assert.equal(malformed.error, "app");
  assert.equal(
    (malformed.details as { category: string }).category,
    "validation",
  );
});

void test("a failed projection write rolls back the pushed command and reports a generic server error", async () => {
  const f = await fixture();
  const projectId = crypto.randomUUID();
  await client`CREATE FUNCTION reject_push_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced projection failure'; END $$`;
  await client`CREATE TRIGGER push_projection_failure BEFORE INSERT ON sync_entity FOR EACH ROW EXECUTE FUNCTION reject_push_projection()`;
  let result: Record<string, unknown>;
  try {
    result = await f.push(f.ownerId, f.mutation(createProject(projectId)));
  } finally {
    await client`DROP TRIGGER push_projection_failure ON sync_entity`;
    await client`DROP FUNCTION reject_push_projection()`;
  }
  assert.equal(result.error, "app");
  assert.deepEqual(result.details, {
    category: "server",
    message: "The operation failed unexpectedly. Retry shortly.",
  });
  assert.doesNotMatch(JSON.stringify(result), /sync_entity|forced/);
  assert.equal(
    (await db.select().from(s.project).where(eq(s.project.id, projectId)))
      .length,
    0,
  );
  assert.equal(await f.lastMutationID(), 1);
});

void test("retried mutations replay: a reused domain id applies once, a resent Zero mutation is already processed", async () => {
  const f = await fixture();
  const projectId = crypto.randomUUID();
  await f.push(f.ownerId, f.mutation(createProject(projectId)));
  const [story] = await db
    .select()
    .from(s.workItemType)
    .where(
      and(
        eq(s.workItemType.organizationId, f.organizationId),
        eq(s.workItemType.name, "Story"),
      ),
    );
  const command: Command = {
    type: "createWorkItem",
    projectId,
    workItemId: crypto.randomUUID(),
    typeId: story!.id,
    parentId: null,
    title: "Once",
  };
  const id = crypto.randomUUID();
  // The same domain mutation arriving as two Zero mutations (another tab, or
  // the capability API and Zero) applies once.
  assert.deepEqual(await f.push(f.ownerId, f.mutation(command, id)), {});
  assert.deepEqual(await f.push(f.ownerId, f.mutation(command, id)), {});
  const count = async () =>
    Number(
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(s.workItem)
          .where(eq(s.workItem.projectId, projectId))
      )[0]!.n,
    );
  assert.equal(await count(), 1);
  assert.equal(committed.filter((c) => c === id).length, 1);
  // Reusing the id for a different command is a conflict.
  const conflict = await f.push(
    f.ownerId,
    f.mutation({ ...command, title: "Different" }, id),
  );
  assert.equal((conflict.details as { category: string }).category, "conflict");
  // zero-cache resending an already processed Zero mutation id.
  const resent = await f.push(f.ownerId, f.mutation(command), 2);
  assert.equal(resent.error, "alreadyProcessed");
  assert.equal(await count(), 1);
});

void test("an organization requiring two-factor refuses a held member's synced queries and pushed commands", async () => {
  const f = await fixture();
  await db.insert(s.organizationSecurityPolicy).values({
    organizationId: f.organizationId,
    requireTwoFactor: true,
  });
  const transform = async (userID: string) => {
    const request = new Request(
      "http://api.test/api/zero/query?schema=zero_0&appID=zero",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          "transform",
          [
            {
              id: "org",
              name: "organization",
              args: [{ organizationId: f.organizationId }],
            },
            { id: "mine", name: "memberships", args: [] },
          ],
        ]),
      },
    );
    return (await zero.query(request, userID)) as {
      queries: { id: string; error?: string; details?: { kind?: string } }[];
    };
  };
  const held = await transform(f.memberId);
  const organization = held.queries.find((q) => q.id === "org")!;
  assert.equal(organization.error, "app");
  assert.equal(organization.details?.kind, "two_factor_required");
  // The organization still appears in the person's memberships.
  assert.equal(held.queries.find((q) => q.id === "mine")!.error, undefined);
  const result = await f.push(f.memberId, f.mutation(createProject()));
  assert.equal(result.error, "app");
  assert.equal(
    (result.details as { kind?: string }).kind,
    "two_factor_required",
  );

  await db
    .update(s.user)
    .set({ twoFactorEnabled: true })
    .where(eq(s.user.id, f.memberId));
  const enrolled = await transform(f.memberId);
  assert.ok(enrolled.queries.every((q) => q.error === undefined));
});
