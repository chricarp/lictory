import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { recordDeparture } from "@lictory/core/domain/account-deletion";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { queries } from "@lictory/zero/queries";
import { schema } from "@lictory/zero/schema";

// The synced queries' authorization, compiled by Zero to SQL and run against
// a disposable database: what each person's subscription would contain.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_query_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const zql = zeroDrizzle(schema, db);
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

type Row = { key?: string; type?: string; spaceId?: string; level?: string };
async function subscribe(
  name: keyof typeof queries,
  userID: string,
  args: Record<string, string>,
) {
  const query = (
    queries[name] as unknown as {
      fn: (input: { args: unknown; ctx: { userID: string } }) => unknown;
    }
  ).fn({ args, ctx: { userID } });
  return (await zql.run(query as Parameters<typeof zql.run>[0])) as Row[];
}

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

void test("Spaces rows reach only their readers, never the organization or work item queries, and leave with access", async () => {
  const organizationId = crypto.randomUUID();
  const [owner, reader, outsider] = await Promise.all(
    ["Owner", "Reader", "Outsider"].map(user),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [
      [owner!, "owner"],
      [reader!, "member"],
    ].map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId: userId!,
      role: role!,
      createdAt: new Date(),
    })),
  );
  await seedOrganization(db, organizationId);
  const run = (actor: string, command: Command) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const open = crypto.randomUUID();
  const restricted = crypto.randomUUID();
  await run(owner!, {
    type: "createSpace",
    spaceId: open,
    name: "Handbook",
    slug: "handbook",
  });
  await run(owner!, {
    type: "createSpace",
    spaceId: restricted,
    name: "Incidents",
    slug: "incidents",
    accessMode: "restricted",
  });
  const openPage = crypto.randomUUID();
  const secretPage = crypto.randomUUID();
  await run(owner!, {
    type: "createPage",
    spaceId: open,
    pageId: openPage,
    title: "Onboarding",
  });
  await run(owner!, {
    type: "createPage",
    spaceId: restricted,
    pageId: secretPage,
    title: "Breach",
  });
  const org = { organizationId };
  const spaceIds = async (userID: string) =>
    [
      ...new Set(
        (await subscribe("spaces", userID, org)).map((r) => r.spaceId),
      ),
    ].sort();

  // The owner reads both spaces (creator of the restricted one); the reader
  // only the inherited one; the outsider nothing.
  assert.deepEqual(await spaceIds(owner!), [open, restricted].sort());
  assert.deepEqual(await spaceIds(reader!), [open]);
  assert.deepEqual(await spaceIds(outsider!), []);
  const readerSpaces = await subscribe("spaces", reader!, org);
  assert.deepEqual(readerSpaces.map((r) => r.type).sort(), ["page", "space"]);
  assert.equal(
    (await subscribe("page", reader!, { organizationId, pageId: openPage }))
      .length,
    2, // the first commit and main
  );
  assert.deepEqual(
    await subscribe("page", reader!, { organizationId, pageId: secretPage }),
    [],
  );
  assert.deepEqual(
    (await subscribe("mySpaceAccess", reader!, org)).map((r) => [
      r.spaceId,
      r.level,
    ]),
    [[open, "edit"]],
  );

  // The organization and work item queries never carry space data.
  const organizationRows = await subscribe("organization", owner!, org);
  assert.ok(organizationRows.length > 0);
  const serialized = JSON.stringify(organizationRows);
  for (const secret of [
    open,
    restricted,
    openPage,
    secretPage,
    "Breach",
    "Onboarding",
  ])
    assert.ok(!serialized.includes(secret), secret);
  assert.deepEqual(
    await subscribe("workItem", owner!, {
      organizationId,
      workItemId: openPage,
    }),
    [],
  );

  // A grant brings the restricted space in; removing it takes it out.
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: reader!,
    level: "view",
  });
  assert.deepEqual(await spaceIds(reader!), [open, restricted].sort());
  assert.equal(
    (await subscribe("page", reader!, { organizationId, pageId: secretPage }))
      .length,
    2,
  );
  await run(owner!, {
    type: "setSpaceGrant",
    spaceId: restricted,
    userId: reader!,
    level: null,
  });
  assert.deepEqual(await spaceIds(reader!), [open]);

  // Losing organization membership removes everything at once, even before
  // Better Auth's hook recomputes effective access.
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, reader!),
      ),
    );
  assert.deepEqual(await spaceIds(reader!), []);
  assert.deepEqual(await subscribe("mySpaceAccess", reader!, org), []);
  await recordDeparture(db, organizationId, reader!);
  assert.deepEqual(
    await db
      .select()
      .from(s.spaceReader)
      .where(eq(s.spaceReader.userId, reader!)),
    [],
  );
});
