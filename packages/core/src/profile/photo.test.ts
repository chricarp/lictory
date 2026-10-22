import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { normalizePhoto, PhotoError } from "@lictory/core/profile/image";
import { MAX_PROFILE_PHOTO_SIZE, safeProfileImage } from "@lictory/core/profile/photo";

void test("photos are square, bounded and stripped of metadata", async () => {
  const input = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "red" },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "Private metadata" } })
    .toBuffer();
  const photo = await normalizePhoto(input);
  const metadata = await sharp(photo).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined);
});

void test("untrusted and oversized images are rejected", async () => {
  for (const [bytes, status] of [
    [Buffer.alloc(0), 400],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 415],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 400],
    [Buffer.alloc(MAX_PROFILE_PHOTO_SIZE + 1), 413],
  ] as const) {
    await assert.rejects(
      normalizePhoto(bytes),
      (error) => error instanceof PhotoError && error.status === status,
    );
  }
  const tooManyPixels = await sharp({
    create: { width: 5001, height: 5000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizePhoto(tooManyPixels), PhotoError);
});

void test("only secure provider URLs and the private photo route are rendered", () => {
  assert.equal(
    safeProfileImage("https://example.test/photo.png"),
    "https://example.test/photo.png",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:image/svg+xml,x",
    "http://example.test/a",
    "//example.test/a",
    "https://user:secret@example.test/a",
    "/api/files/abc",
    null,
  ])
    assert.equal(safeProfileImage(url), null);
});
