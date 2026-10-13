import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { storageConfiguration } from "./configuration";
import { s3Storage, type ObjectStorage } from "./s3";

export type { ObjectStorage } from "./s3";
export { s3Storage } from "./s3";
export { StorageConfigurationError } from "./errors";

let configured: ObjectStorage | undefined;
export function storage(): ObjectStorage {
  if (configured) return configured;
  const { client, bucket } = storageConfiguration(process.env);
  configured = s3Storage(new S3Client(client), bucket);
  return configured;
}
