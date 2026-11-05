import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Directory } from "@lictory/core/contracts/protocol";
import { executeMutation } from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";
import { refreshAiAvailability } from "@lictory/core/domain/ai";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_ai_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
const savedKey = process.env.OPENAI_API_KEY;
before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

void test("connecting an AI provider reaches existing directories at startup", async () => {
  delete process.env.OPENAI_API_KEY;
  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  await db
    .insert(s.user)
    .values({ id: userId, name: "Ada", email: `${userId}@example.test` });
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Northwind",
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
  await executeMutation(
    db,
    { userId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId: crypto.randomUUID(),
        name: "Payments",
        key: "PAY",
      },
    },
  );
  const available = async () => {
    const [row] = await db
      .select({ data: s.syncEntity.data })
      .from(s.syncEntity)
      .where(
        and(
          eq(s.syncEntity.organizationId, organizationId),
          eq(s.syncEntity.type, "directory"),
        ),
      );
    return (row!.data as unknown as Directory).ai.available;
  };
  assert.equal(await available(), false);
  // The provider is connected and the server restarts.
  process.env.OPENAI_API_KEY = "test-key-not-a-credential";
  assert.equal(await refreshAiAvailability(db), 1);
  assert.equal(await available(), true);
  // Nothing left to refresh on the next start.
  assert.equal(await refreshAiAvailability(db), 0);
  // Removing the provider is reflected the same way.
  delete process.env.OPENAI_API_KEY;
  assert.equal(await refreshAiAvailability(db), 1);
  assert.equal(await available(), false);
});
