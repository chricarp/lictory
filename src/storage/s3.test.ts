import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { s3Storage } from "./s3";

void test("signed writes are scoped, short-lived, and create-only", async () => {
  const storage = s3Storage(
    new S3Client({
      region: "auto",
      forcePathStyle: true,
      endpoint:
        "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "key", secretAccessKey: "secret" },
    }),
    "private-files",
  );
  const url = new URL(
    await storage.presignUpload(
      "organizations/org/files/one",
      "image/png",
      123,
    ),
  );
  assert.equal(
    url.host,
    "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  );
  assert.equal(url.pathname, "/private-files/organizations/org/files/one");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.match(
    url.searchParams.get("X-Amz-SignedHeaders") ?? "",
    /if-none-match/,
  );
  assert.match(
    url.searchParams.get("X-Amz-SignedHeaders") ?? "",
    /content-length/,
  );
  const read = new URL(
    await storage.presignDownload(
      "organizations/org/files/one",
      "a.png",
      "image/png",
      true,
    ),
  );
  assert.equal(read.searchParams.get("X-Amz-Expires"), "60");
  assert.match(
    read.searchParams.get("response-content-disposition") ?? "",
    /inline/,
  );
});
