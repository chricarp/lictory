import { S3Client } from "@aws-sdk/client-s3";
import {
  storageSettings,
  type StorageSettings,
} from "@lictory/core/storage/config";
import { StorageConfigurationError } from "@lictory/core/storage/errors";
import { s3Storage, type ObjectStorage } from "@lictory/core/storage/s3";

export type { ObjectStorage } from "@lictory/core/storage/s3";

// The environment does not change while the process runs: resolve it once.
let resolved: { settings?: StorageSettings } | undefined;
let configured: ObjectStorage | undefined;

// This deployment's storage settings, undefined when attachments are disabled.
// Throws StorageConfigurationError for an invalid configuration; the API calls
// it at startup so a broken configuration stops the process with the reason.
export function storageConfiguration(): StorageSettings | undefined {
  resolved ??= { settings: storageSettings(process.env) };
  return resolved.settings;
}

// Whether attachments can be uploaded and downloaded on this deployment.
export function attachmentsAvailable(): boolean {
  try {
    return storageConfiguration() !== undefined;
  } catch {
    return false;
  }
}

export function storage(): ObjectStorage {
  if (configured) return configured;
  const settings = storageConfiguration();
  if (!settings)
    throw new StorageConfigurationError(
      "No file storage is configured (S3_* or R2_*).",
    );
  configured = objectStorage(settings);
  return configured;
}

export function objectStorage(settings: StorageSettings): ObjectStorage {
  return s3Storage(
    new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      // The SDK's default CRC32 checksums would sign a checksum of the empty
      // body into presigned uploads; many S3-compatible services reject them.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
    }),
    settings.bucket,
  );
}
