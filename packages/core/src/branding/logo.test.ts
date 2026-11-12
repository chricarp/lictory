import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { directory } from "@lictory/core/domain/service";
import { directorySchema } from "@lictory/core/contracts/protocol";
import { render } from "@react-email/render";
import {
  checkLogo,
  imageSize,
  publicLogoPath,
} from "@lictory/core/branding/logo";
import {
  emailBrand,
  LogoError,
  readLogo,
  readPublicLogo,
  removeLogo,
  setBrandColor,
  setLogo,
} from "@lictory/core/branding/server";
import { createInvitationEmail } from "@lictory/core/emails/invitation-email";

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
  assert.deepEqual(empty.organizations[0]!.logos, {
    mark: null,
    full: null,
    icon: null,
  });

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

// A PNG header declaring the given dimensions.
const sizedPng = (width: number, height: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};

void test("image dimensions are read from PNG, JPEG and WebP headers", () => {
  assert.deepEqual(imageSize(sizedPng(600, 100)), { width: 600, height: 100 });
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
    0x08, 0x00, 0x40, 0x01, 0x80, 0x03, 0x01, 0x11, 0x00,
  ]);
  assert.deepEqual(imageSize(jpeg), { width: 384, height: 64 });
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode("RIFF"));
  webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
  webp.set([0x57, 0x02, 0x00, 0x63, 0x00, 0x00], 24);
  assert.deepEqual(imageSize(webp), { width: 600, height: 100 });
  assert.equal(imageSize(png()), null);
  assert.equal(imageSize(svg), null);
});

void test("the browser icon is a logo of its own in the directory", async () => {
  const o = await organization();
  await setLogo(db, o.organizationId, o.ownerId, "icon", png());
  const logos = directorySchema.parse(await directory(db, o.memberId))
    .organizations[0]!.logos;
  assert.match(logos.icon ?? "", /\/logo\/icon\?v=/);
  assert.equal(logos.mark, null);
  await removeLogo(db, o.organizationId, o.ownerId, "icon");
  assert.equal(
    directorySchema.parse(await directory(db, o.memberId)).organizations[0]!
      .logos.icon,
    null,
  );
});

void test("administrators set and reset the brand color; members see it", async () => {
  const o = await organization();
  const color = async () =>
    directorySchema.parse(await directory(db, o.memberId)).organizations[0]!
      .brandColor;
  assert.equal(await color(), null);
  await rejects(
    setBrandColor(db, o.organizationId, o.memberId, "#1d4ed8"),
    403,
  );
  await rejects(
    setBrandColor(db, o.organizationId, o.outsiderId, "#1d4ed8"),
    403,
  );
  await rejects(setBrandColor(db, o.organizationId, o.ownerId, "blue"), 400);
  assert.equal(await color(), null);

  await setBrandColor(db, o.organizationId, o.ownerId, "#1D4ED8");
  assert.equal(await color(), "#1d4ed8");
  const [profile] = await db
    .select({ data: s.syncEntity.data })
    .from(s.syncEntity)
    .where(eq(s.syncEntity.key, `organizationProfile:${o.organizationId}`));
  assert.equal(
    (profile?.data as { brandColor?: string } | undefined)?.brandColor,
    "#1d4ed8",
  );

  await setBrandColor(db, o.organizationId, o.ownerId, null);
  assert.equal(await color(), null);
});

void test("email finds a logo only by the hash of its current content", async () => {
  const o = await organization();
  const { sha256 } = await setLogo(
    db,
    o.organizationId,
    o.ownerId,
    "mark",
    png(),
  );
  const logo = await readPublicLogo(db, o.organizationId, "mark", sha256);
  assert.deepEqual(new Uint8Array(logo.content), png());
  await rejects(readPublicLogo(db, o.organizationId, "full", sha256), 404);
  await rejects(
    readPublicLogo(db, o.organizationId, "mark", "0".repeat(64)),
    404,
  );
  const other = await organization();
  await rejects(readPublicLogo(db, other.organizationId, "mark", sha256), 404);
  // Replacing the image retires the address that was sent out.
  await setLogo(db, o.organizationId, o.ownerId, "mark", png(1));
  await rejects(readPublicLogo(db, o.organizationId, "mark", sha256), 404);
});

void test("organization email carries the organization's logo and color, each falling back to Lictory's", async () => {
  const o = await organization();
  const base = "https://lictory.example.test";
  const invitation = async () => {
    const brand = await emailBrand(db, o.organizationId, "Acme", base);
    const html = await render(
      createInvitationEmail({
        to: "new@example.test",
        inviterName: "Ada",
        organizationName: "Acme",
        existingUser: false,
        actionUrl: `${base}/sign-up`,
        expiresAt: new Date(0),
        brand,
      }).react,
    );
    return { brand, html };
  };

  const plain = await invitation();
  assert.deepEqual(plain.brand, { name: "Acme", logo: null, tone: null });
  assert.match(plain.html, /lictory-logo\.png/);
  assert.match(plain.html, /#2563eb/);

  // A pale color is darkened until white text on it is readable.
  await setBrandColor(db, o.organizationId, o.ownerId, "#ffd600");
  const marked = await setLogo(
    db,
    o.organizationId,
    o.ownerId,
    "mark",
    sizedPng(512, 512),
  );
  const mark = await invitation();
  assert.deepEqual(mark.brand.logo, {
    kind: "mark",
    url: base + publicLogoPath(o.organizationId, "mark", marked.sha256),
    width: 34,
    height: 34,
  });
  assert.notEqual(mark.brand.tone?.color, "#ffd600");
  assert.ok(mark.html.includes(mark.brand.logo.url));
  assert.ok(mark.html.includes(mark.brand.tone!.color));
  assert.doesNotMatch(mark.html, /lictory-logo\.png|#2563eb/);

  // The wide logo wins and keeps its proportions within the header.
  const full = await setLogo(
    db,
    o.organizationId,
    o.ownerId,
    "full",
    sizedPng(1200, 100),
  );
  const wide = await invitation();
  assert.deepEqual(wide.brand.logo, {
    kind: "full",
    url: base + publicLogoPath(o.organizationId, "full", full.sha256),
    width: 240,
    height: 20,
  });
});
