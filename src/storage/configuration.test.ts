import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { storageConfiguration } from "./configuration";
import { s3Storage } from "./s3";

const r2 = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "private-files",
};
const s3 = {
  LICTORY_STORAGE_PROVIDER: "s3",
  S3_REGION: "us-east-1",
  S3_BUCKET_NAME: "private-files",
};

void test("existing R2 deployments retain their endpoint and credentials", () => {
  const config = storageConfiguration(r2);
  assert.equal(config.bucket, "private-files");
  assert.equal(
    config.client.endpoint,
    `https://${r2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  );
  assert.equal(config.client.region, "auto");
  for (const endpoint of [
    `https://${r2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    `https://${r2.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
  ])
    assert.equal(
      storageConfiguration({ ...r2, R2_S3_ENDPOINT: endpoint }).client.endpoint,
      endpoint,
    );
  assert.throws(() =>
    storageConfiguration({ ...r2, R2_S3_ENDPOINT: "https://other.example" }),
  );
});

void test("S3 supports IAM credentials and rejects incomplete static credentials", () => {
  assert.equal(storageConfiguration(s3).client.credentials, undefined);
  assert.throws(() => storageConfiguration({ ...s3, S3_ACCESS_KEY_ID: "key" }));
  assert.throws(() => storageConfiguration({ ...s3, S3_REGION: "" }));
  assert.throws(() =>
    storageConfiguration({ ...s3, LICTORY_STORAGE_PROVIDER: "unknown" }),
  );
});

void test("custom S3 signed uploads preserve private, create-only tenant keys", async () => {
  const config = storageConfiguration({
    ...s3,
    S3_ENDPOINT: "http://localhost:9000",
    S3_FORCE_PATH_STYLE: "true",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
  });
  const url = new URL(
    await s3Storage(new S3Client(config.client), config.bucket).presignUpload(
      "organizations/org/files/one",
      "image/png",
      123,
    ),
  );
  assert.equal(url.origin, "http://localhost:9000");
  assert.equal(url.pathname, "/private-files/organizations/org/files/one");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.match(
    url.searchParams.get("X-Amz-SignedHeaders") ?? "",
    /if-none-match/,
  );
});

void test("custom endpoints cannot contain credentials or use remote plain HTTP", () => {
  for (const endpoint of [
    "http://storage.example",
    "https://key:secret@storage.example",
    "https://storage.example/bucket",
    "https://storage.example?token=secret",
    "invalid",
  ])
    assert.throws(() => storageConfiguration({ ...s3, S3_ENDPOINT: endpoint }));
  assert.throws(() =>
    storageConfiguration({ ...s3, S3_FORCE_PATH_STYLE: "yes" }),
  );
});
