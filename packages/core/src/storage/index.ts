import { S3Client } from "@aws-sdk/client-s3";
import { s3Storage, type ObjectStorage } from "@lictory/core/storage/s3";

export type { ObjectStorage } from "@lictory/core/storage/s3";
export { s3Storage } from "@lictory/core/storage/s3";

import { StorageConfigurationError } from "@lictory/core/storage/errors";

export { StorageConfigurationError };

let configured: ObjectStorage | undefined;
export function storage(): ObjectStorage {
  if (configured) return configured;
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_S3_ENDPOINT,
  } = process.env;
  if (
    ![
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME,
    ].every(Boolean)
  )
    throw new StorageConfigurationError(
      "R2 account ID, access key, secret key and bucket name are required for file uploads.",
    );
  if (!/^[a-z0-9]{32}$/.test(R2_ACCOUNT_ID!))
    throw new StorageConfigurationError("Invalid R2 account ID.");
  if (
    R2_S3_ENDPOINT &&
    !new RegExp(
      `^https://${R2_ACCOUNT_ID}\\.(?:eu\\.)?r2\\.cloudflarestorage\\.com/?$`,
    ).test(R2_S3_ENDPOINT)
  )
    throw new StorageConfigurationError("Invalid R2 S3 endpoint.");
  configured = s3Storage(
    new S3Client({
      region: "auto",
      forcePathStyle: true,
      endpoint:
        R2_S3_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    }),
    R2_BUCKET_NAME!,
  );
  return configured;
}
