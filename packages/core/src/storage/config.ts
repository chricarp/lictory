import { StorageConfigurationError } from "@lictory/core/storage/errors";

// Where attachment bytes live. Any S3-compatible service works through the
// generic S3_* settings; R2_* is a preset for Cloudflare R2 kept for existing
// deployments. Setting neither disables attachments: the server still starts
// and upload requests fail with an explanation.

export type StorageSettings = {
  preset: "s3" | "r2";
  // Undefined means the AWS endpoint for `region`.
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
] as const;
const R2_VARIABLES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_S3_ENDPOINT",
] as const;

type Env = Record<string, string | undefined>;

// Compose files pass unset variables through as empty strings.
function read(env: Env, name: string) {
  const value = env[name]?.trim();
  if (!value) return undefined;
  return value;
}

function missing(env: Env, names: readonly string[]) {
  return names.filter((name) => !read(env, name));
}

const DOCS = "See docs/internals/file-storage.md.";

// Resolves storage settings from the environment. Returns undefined when no
// storage variable is set; throws StorageConfigurationError, naming the
// variables to fix, for a partial, ambiguous or malformed configuration.
export function storageSettings(env: Env): StorageSettings | undefined {
  const s3 = S3_VARIABLES.filter((name) => read(env, name));
  const r2 = R2_VARIABLES.filter((name) => read(env, name));
  if (s3.length && r2.length)
    throw new StorageConfigurationError(
      `Both S3_* (${s3.join(", ")}) and R2_* (${r2.join(", ")}) storage settings are set. Configure one of them and unset the other. ${DOCS}`,
    );
  if (s3.length) return genericSettings(env);
  if (r2.length) return r2Settings(env);
  return undefined;
}

function genericSettings(env: Env): StorageSettings {
  const absent = missing(env, [
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]);
  const endpoint = read(env, "S3_ENDPOINT");
  const region = read(env, "S3_REGION");
  // Without an endpoint the SDK addresses AWS, which needs the bucket's region.
  if (!endpoint && !region) absent.push("S3_ENDPOINT or S3_REGION");
  if (absent.length)
    throw new StorageConfigurationError(
      `S3 storage is partly configured. Set ${absent.join(", ")}, or unset every S3_* variable to disable attachments. ${DOCS}`,
    );
  if (endpoint) checkEndpoint(endpoint);
  return {
    preset: "s3",
    endpoint,
    region: region ?? "us-east-1",
    bucket: read(env, "S3_BUCKET")!,
    accessKeyId: read(env, "S3_ACCESS_KEY_ID")!,
    secretAccessKey: read(env, "S3_SECRET_ACCESS_KEY")!,
    // Self-hosted services (MinIO, Garage, Ceph) rarely have wildcard DNS for
    // bucket subdomains; AWS itself prefers virtual-hosted style.
    forcePathStyle: flag(env, "S3_FORCE_PATH_STYLE") ?? Boolean(endpoint),
  };
}

function checkEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new StorageConfigurationError(
      `S3_ENDPOINT must be an absolute http(s) URL such as https://s3.example.com, not "${endpoint}". ${DOCS}`,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new StorageConfigurationError(
      `S3_ENDPOINT must be an http(s) URL without credentials, query or fragment, such as https://s3.example.com. ${DOCS}`,
    );
}

function flag(env: Env, name: string) {
  const value = read(env, name)?.toLowerCase();
  if (value === undefined) return undefined;
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new StorageConfigurationError(
    `${name} must be true or false, not "${read(env, name)}".`,
  );
}

function r2Settings(env: Env): StorageSettings {
  const absent = missing(env, [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ]);
  if (absent.length)
    throw new StorageConfigurationError(
      `Cloudflare R2 storage is partly configured. Set ${absent.join(", ")}, or unset every R2_* variable to disable attachments. ${DOCS}`,
    );
  const account = read(env, "R2_ACCOUNT_ID")!;
  if (!/^[a-z0-9]{32}$/.test(account))
    throw new StorageConfigurationError(
      "R2_ACCOUNT_ID must be the 32-character Cloudflare account ID (lowercase letters and digits).",
    );
  const endpoint = read(env, "R2_S3_ENDPOINT");
  if (
    endpoint &&
    !new RegExp(
      `^https://${account}\\.(?:eu\\.)?r2\\.cloudflarestorage\\.com/?$`,
    ).test(endpoint)
  )
    throw new StorageConfigurationError(
      `R2_S3_ENDPOINT must be the account's S3 API host, https://${account}.r2.cloudflarestorage.com or https://${account}.eu.r2.cloudflarestorage.com. For another provider, use the S3_* settings instead.`,
    );
  return {
    preset: "r2",
    endpoint: endpoint ?? `https://${account}.r2.cloudflarestorage.com`,
    region: "auto",
    bucket: read(env, "R2_BUCKET_NAME")!,
    accessKeyId: read(env, "R2_ACCESS_KEY_ID")!,
    secretAccessKey: read(env, "R2_SECRET_ACCESS_KEY")!,
    forcePathStyle: true,
  };
}
