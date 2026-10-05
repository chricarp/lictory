import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "~/db/schema";
import { directory } from "~/sync/server/service";
import { directorySchema } from "~/sync/shared/protocol";
import { checkLogo } from "./logo";
import { LogoError, readLogo, removeLogo, setLogo } from "./server";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_logo_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

const png = (extra = 0) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...new Array<number>(16 + extra).fill(1),
  ]);
const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

async function organization() {
  const organizationId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  await db.insert(s.user).values(
    [ownerId, memberId, outsiderId].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
    })),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Acme",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    (
      [
        [ownerId, "owner"],
        [memberId, "member"],
      ] as const
    ).map(([userId, role]) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    })),
  );
  return { organizationId, ownerId, memberId, outsiderId };
}

const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(promise, (e) => e instanceof LogoError && e.status === status);

void test("logos accept raster images by content and reject SVG and oversize files", () => {
  assert.deepEqual(checkLogo(png()), { ok: true, mimeType: "image/png" });
  assert.equal(checkLogo(svg).ok, false);
  assert.equal(checkLogo(new Uint8Array()).ok, false);
  const big = checkLogo(png(600 * 1024));
  assert.equal(big.ok || big.status, 413);
});

void test("administrators set and remove logos; members see them in the directory", async () => {
  const o = await organization();
  const empty = directorySchema.parse(await directory(db, o.memberId));
  assert.deepEqual(empty.organizations[0]!.logos, { mark: null, full: null });

  await setLogo(db, o.organizationId, o.ownerId, "mark", png());
  const first = directorySchema.parse(await directory(db, o.memberId))
    .organizations[0]!.logos;
  assert.match(first.mark ?? "", /^\/api\/organizations\/.+\/logo\/mark\?v=/);
  assert.equal(first.full, null);

  // Replacing the image changes the URL so cached copies are not reused.
  await setLogo(db, o.organizationId, o.ownerId, "mark", png(1));
  const second = directorySchema.parse(await directory(db, o.memberId))
    .organizations[0]!.logos;
  assert.notEqual(second.mark, first.mark);

  const logo = await readLogo(db, o.organizationId, o.memberId, "mark");
  assert.equal(logo.mimeType, "image/png");
  assert.deepEqual(new Uint8Array(logo.content), png(1));

  await removeLogo(db, o.organizationId, o.ownerId, "mark");
  await rejects(readLogo(db, o.organizationId, o.memberId, "mark"), 404);
});

void test("only administrators change logos and only members read them", async () => {
  const o = await organization();
  await rejects(setLogo(db, o.organizationId, o.memberId, "full", png()), 403);
  await rejects(
    setLogo(db, o.organizationId, o.outsiderId, "full", png()),
    403,
  );
  await setLogo(db, o.organizationId, o.ownerId, "full", png());
  await rejects(removeLogo(db, o.organizationId, o.memberId, "full"), 403);
  await rejects(readLogo(db, o.organizationId, o.outsiderId, "full"), 403);
  await rejects(setLogo(db, o.organizationId, o.ownerId, "full", svg), 415);
});
