import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { StorageConfigurationError } from "./errors";

type Environment = Record<string, string | undefined>;

/** One provider per deployment. Existing R2 installations keep their settings. */
export function storageConfiguration(env: Environment): {
  client: S3ClientConfig;
  bucket: string;
} {
  const value = (name: string) => {
    const raw = env[name]?.trim();
    return raw?.length ? raw : undefined;
  };
  const provider = value("LICTORY_STORAGE_PROVIDER") ?? "r2";
  if (provider === "s3") {
    const bucket = value("S3_BUCKET_NAME");
    const region = value("S3_REGION");
    const accessKeyId = value("S3_ACCESS_KEY_ID");
    const secretAccessKey = value("S3_SECRET_ACCESS_KEY");
    if (!bucket || !region)
      throw new StorageConfigurationError(
        "S3_BUCKET_NAME and S3_REGION are required for file uploads.",
      );
    if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
      throw new StorageConfigurationError(
        "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or use the AWS credential chain.",
      );
    const endpoint = value("S3_ENDPOINT");
    if (endpoint) {
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch {
        throw new StorageConfigurationError("Invalid S3 endpoint URL.");
      }
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new StorageConfigurationError(
          "S3_ENDPOINT must be an HTTPS origin (HTTP is allowed only on loopback for development).",
        );
    }
    const pathStyle = value("S3_FORCE_PATH_STYLE");
    if (pathStyle && !["true", "false"].includes(pathStyle))
      throw new StorageConfigurationError(
        "S3_FORCE_PATH_STYLE must be true or false.",
      );
    return {
      bucket,
      client: {
        region,
        endpoint,
        forcePathStyle: pathStyle === "true",
        // Omit credentials to support IAM roles and the standard AWS chain.
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      },
    };
  }
  if (provider !== "r2")
    throw new StorageConfigurationError(
      "LICTORY_STORAGE_PROVIDER must be r2 or s3.",
    );
  const account = value("R2_ACCOUNT_ID");
  const accessKeyId = value("R2_ACCESS_KEY_ID");
  const secretAccessKey = value("R2_SECRET_ACCESS_KEY");
  const bucket = value("R2_BUCKET_NAME");
  if (!account || !accessKeyId || !secretAccessKey || !bucket)
    throw new StorageConfigurationError(
      "R2 account ID, access key, secret key and bucket name are required for file uploads.",
    );
  if (!/^[a-z0-9]{32}$/.test(account))
    throw new StorageConfigurationError("Invalid R2 account ID.");
  const endpoint = value("R2_S3_ENDPOINT");
  if (
    endpoint &&
    !new RegExp(
      `^https://${account}\\.(?:eu\\.)?r2\\.cloudflarestorage\\.com/?$`,
    ).test(endpoint)
  )
    throw new StorageConfigurationError("Invalid R2 S3 endpoint.");
  return {
    bucket,
    client: {
      region: "auto",
      forcePathStyle: true,
      endpoint: endpoint ?? `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    },
  };
}
