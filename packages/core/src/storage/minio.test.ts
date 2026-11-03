import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { storageSettings } from "@lictory/core/storage/config";
import { objectStorage } from "@lictory/core/storage";

// Exercises the real S3 protocol against MinIO: the `minio` service of the
// development compose.yaml, or S3_TEST_* pointing elsewhere. Skipped when no
// MinIO answers, so the default test run needs no object storage.

// Empty values count as unset, as in the application's own settings.
function setting(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value;
}
const endpoint = setting("S3_TEST_ENDPOINT", "http://127.0.0.1:9000");
const reachable = await fetch(new URL("/minio/health/live", endpoint), {
  signal: AbortSignal.timeout(1_000),
}).then(
  (response) => response.ok,
  () => false,
);
const skip = reachable ? false : `no MinIO at ${endpoint}`;

const bucket = `lictory-test-${crypto.randomUUID().slice(0, 8)}`;
const settings = storageSettings({
  S3_ENDPOINT: endpoint,
  S3_BUCKET: bucket,
  S3_ACCESS_KEY_ID: setting("S3_TEST_ACCESS_KEY_ID", "lictory"),
  S3_SECRET_ACCESS_KEY: setting(
    "S3_TEST_SECRET_ACCESS_KEY",
    "lictory-development",
  ),
})!;
const admin = new S3Client({
  endpoint,
  region: settings.region,
  forcePathStyle: true,
  credentials: {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  },
});

before(async () => {
  if (!skip) await admin.send(new CreateBucketCommand({ Bucket: bucket }));
});
after(async () => {
  if (skip) return;
  const listed = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
  for (const object of listed.Contents ?? [])
    await admin.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
    );
  await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
});

void test(
  "upload, finalize and download through presigned URLs",
  { skip },
  async () => {
    const storage = objectStorage(settings);
    const key = "organizations/org/files/one";
    const body = "Retries reuse the original transaction ID.\n";
    const size = new TextEncoder().encode(body).byteLength;
    const uploadUrl = await storage.presignUpload(key, "text/plain", size);
    const headers = { "Content-Type": "text/plain", "If-None-Match": "*" };

    // The browser's CORS preflight for the direct upload.
    const preflight = await fetch(uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,if-none-match",
      },
    });
    assert.ok(preflight.headers.get("access-control-allow-origin"));

    const longer = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: `${body}more`,
    });
    assert.equal(longer.ok, false, "the signature binds the content length");
    const put = await fetch(uploadUrl, { method: "PUT", headers, body });
    assert.equal(put.status, 200, await put.text());
    const replay = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      body: "overwrite",
    });
    assert.equal(replay.ok, false, "a reused URL cannot overwrite the object");

    assert.deepEqual(await storage.stat(key), {
      size,
      contentType: "text/plain",
    });

    const download = await fetch(
      await storage.presignDownload(key, "notes ä.txt", "text/plain", false),
    );
    assert.equal(download.status, 200);
    assert.equal(await download.text(), body);
    assert.match(
      download.headers.get("content-disposition") ?? "",
      /^attachment; filename\*=UTF-8''notes%20%C3%A4\.txt$/,
    );

    // Removal: copy aside, then delete the original key.
    await storage.copy(key, "organizations/org/removed-files/one");
    await storage.delete(key);
    await assert.rejects(storage.stat(key));
    assert.equal(
      (await storage.stat("organizations/org/removed-files/one")).size,
      size,
    );
  },
);
