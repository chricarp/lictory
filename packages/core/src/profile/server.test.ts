import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import sharp from "sharp";
import * as s from "@lictory/core/db/schema";
import {
  importProviderPhoto,
  readProfilePhoto,
  setProfilePhoto,
} from "@lictory/core/profile/server";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_photo_test_${crypto.randomUUID().replaceAll("-", "")}`;
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

void test("personal photos replace provider photos, remain private, and can be removed", async () => {
  const owner = crypto.randomUUID(),
    colleague = crypto.randomUUID(),
    outsider = crypto.randomUUID(),
    organizationId = crypto.randomUUID();
  await db.insert(s.user).values(
    [owner, colleague, outsider].map((id) => ({
      id,
      name: "Same name",
      email: `${id}@example.test`,
      image: "https://example.test/provider.png",
    })),
  );
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const first = await setProfilePhoto(db, owner, png);
  assert.match(first.image!, /^\/api\/users\/.+\/photo\?v=/);
  assert.equal(
    (await readProfilePhoto(db, owner, owner)).content.length > 0,
    true,
  );
  await assert.rejects(
    readProfilePhoto(db, outsider, owner),
    /Photo not found/,
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Shared",
    slug: organizationId,
    createdAt: new Date(),
  });
  await db.insert(s.member).values(
    [owner, colleague].map((userId) => ({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "member",
      createdAt: new Date(),
    })),
  );
  assert.equal(
    (await readProfilePhoto(db, colleague, owner)).sha256,
    (await readProfilePhoto(db, owner, owner)).sha256,
  );
  await db.delete(s.member).where(eq(s.member.userId, colleague));
  await assert.rejects(
    readProfilePhoto(db, colleague, owner),
    /Photo not found/,
  );
  await assert.rejects(setProfilePhoto(db, owner, Buffer.from("not an image")));
  assert.equal(
    (await db.select().from(s.user).where(eq(s.user.id, owner)))[0]!.image,
    first.image,
  );
  const replacement = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  assert.notEqual(
    (await setProfilePhoto(db, owner, replacement)).image,
    first.image,
  );
  await Promise.all([
    setProfilePhoto(db, owner, png),
    setProfilePhoto(db, owner, replacement),
  ]);
  const photo = await readProfilePhoto(db, owner, owner);
  assert.equal(
    (
      await db.select().from(s.user).where(eq(s.user.id, owner))
    )[0]!.image!.endsWith(photo.sha256),
    true,
  );
  await setProfilePhoto(db, owner, null);
  assert.equal(
    (await db.select().from(s.user).where(eq(s.user.id, owner)))[0]!.image,
    null,
  );
  await assert.rejects(readProfilePhoto(db, owner, owner), /Photo not found/);
  await setProfilePhoto(db, owner, null);
  assert.equal(
    (await db.select().from(s.user).where(eq(s.user.id, outsider)))[0]!.image,
    "https://example.test/provider.png",
  );
});

void test("provider photo bytes become a private image URL and invalid photos do not block signup", async () => {
  const id = crypto.randomUUID();
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const user = {
    id,
    image: `data:image/png;base64, ${png.toString("base64")}` as string | null,
  };
  await db.insert(s.user).values({
    id,
    name: "Provider",
    email: `${id}@example.test`,
    image: user.image,
  });
  await importProviderPhoto(db, user);
  assert.match(user.image!, /^\/api\/users\//);
  assert.equal(
    (await db.select().from(s.user).where(eq(s.user.id, id)))[0]!.image,
    user.image,
  );
  user.image = "data:image/jpeg;base64, bm90LWEtcGhvdG8=";
  await importProviderPhoto(db, user);
  assert.equal(user.image, null);
});
