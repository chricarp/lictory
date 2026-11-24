import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL } from "@lictory/core/contracts/protocol";
import { executeMutation } from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_keys_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

// Project keys become the address segment after the organization
// (`/{org}/{key}`); a key equal to a module page's segment would be
// unreachable, so the server refuses it.
void test("project keys that name an organization page are refused", async () => {
  const userId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Ada", email: `${userId}@example.test` });
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Keys",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: "owner",
    createdAt: new Date(),
  });
  await seedOrganization(db, organizationId);
  const create = (key: string) =>
    executeMutation(
      db,
      { userId },
      {
        protocol: PROTOCOL,
        id: crypto.randomUUID(),
        organizationId,
        command: {
          type: "createProject",
          projectId: crypto.randomUUID(),
          name: key,
          key,
        },
      },
    );
  for (const key of ["CHANNELS", "FACTORY", "CODE", "SPACES", "SEARCH"])
    await assert.rejects(create(key), /is reserved by Lictory/);
  await create("CODEX");
  const projects = await db.select({ key: s.project.key }).from(s.project);
  assert.deepEqual(
    projects.map((p) => p.key),
    ["CODEX"],
  );
});
