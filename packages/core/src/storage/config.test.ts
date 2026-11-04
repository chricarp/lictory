import assert from "node:assert/strict";
import { test } from "node:test";
import { storageSettings } from "@lictory/core/storage/config";
import { StorageConfigurationError } from "@lictory/core/storage/errors";

const account = "0123456789abcdef0123456789abcdef";
const r2 = {
  R2_ACCOUNT_ID: account,
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_BUCKET_NAME: "lictory-files",
};
const minio = {
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "lictory-files",
  S3_ACCESS_KEY_ID: "lictory",
  S3_SECRET_ACCESS_KEY: "lictory-development",
};

function rejects(env: Record<string, string>, message: RegExp) {
  assert.throws(
    () => storageSettings(env),
    (error: unknown) =>
      error instanceof StorageConfigurationError && message.test(error.message),
  );
}

void test("without storage variables attachments are disabled, not an error", () => {
  assert.equal(storageSettings({}), undefined);
  // Compose passes unset variables as empty strings.
  assert.equal(
    storageSettings({
      R2_ACCOUNT_ID: "",
      R2_S3_ENDPOINT: "",
      S3_ENDPOINT: " ",
      S3_FORCE_PATH_STYLE: "",
    }),
    undefined,
  );
});

void test("existing R2 variables keep working unchanged", () => {
  assert.deepEqual(storageSettings({ ...r2, R2_S3_ENDPOINT: "" }), {
    preset: "r2",
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: "auto",
    bucket: "lictory-files",
    accessKeyId: "r2-key",
    secretAccessKey: "r2-secret",
    forcePathStyle: true,
  });
  const eu = `https://${account}.eu.r2.cloudflarestorage.com`;
  assert.equal(storageSettings({ ...r2, R2_S3_ENDPOINT: eu })?.endpoint, eu);
});

void test("R2 values are still validated", () => {
  rejects({ ...r2, R2_ACCOUNT_ID: "restore-drill" }, /R2_ACCOUNT_ID/);
  rejects(
    { ...r2, R2_S3_ENDPOINT: "https://s3.example.com" },
    /R2_S3_ENDPOINT.*S3_\* settings/,
  );
  rejects(
    { R2_ACCOUNT_ID: account, R2_BUCKET_NAME: "files" },
    /partly configured.*R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
  );
});

void test("generic S3 settings address any compatible service", () => {
  assert.deepEqual(storageSettings(minio), {
    preset: "s3",
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    bucket: "lictory-files",
    accessKeyId: "lictory",
    secretAccessKey: "lictory-development",
    forcePathStyle: true,
  });
  // AWS: no endpoint, the bucket's region, virtual-hosted addressing.
  const aws = storageSettings({
    S3_REGION: "eu-central-1",
    S3_BUCKET: "files",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
  });
  assert.equal(aws?.endpoint, undefined);
  assert.equal(aws?.region, "eu-central-1");
  assert.equal(aws?.forcePathStyle, false);
  assert.equal(
    storageSettings({
      ...minio,
      S3_REGION: "garage",
      S3_FORCE_PATH_STYLE: "false",
    })?.forcePathStyle,
    false,
  );
});

void test("partial or malformed S3 settings name what to fix", () => {
  rejects(
    { S3_ENDPOINT: "http://127.0.0.1:9000", S3_BUCKET: "files" },
    /partly configured.*S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/,
  );
  rejects(
    { S3_BUCKET: "files", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" },
    /S3_ENDPOINT or S3_REGION/,
  );
  rejects({ ...minio, S3_ENDPOINT: "minio:9000" }, /http\(s\) URL/);
  rejects({ ...minio, S3_ENDPOINT: "not a url" }, /absolute http\(s\) URL/);
  rejects(
    { ...minio, S3_ENDPOINT: "https://user:pass@s3.example.com" },
    /without credentials/,
  );
  rejects({ ...minio, S3_FORCE_PATH_STYLE: "maybe" }, /true or false/);
});

void test("setting both S3 and R2 variables is ambiguous", () => {
  rejects({ ...r2, S3_BUCKET: "other" }, /Both S3_\*.*and R2_\*/);
  rejects({ ...minio, R2_S3_ENDPOINT: "https://x" }, /Configure one/);
});
