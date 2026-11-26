export class StorageConfigurationError extends Error {}

// What people read where they would attach a file on a server without file
// storage (the default of a self-hosted install): why, who changes it and
// what works meanwhile. Shared by the editors, the attachment list and the
// API's refusal so every surface says the same.
export const ATTACHMENTS_UNAVAILABLE =
  "Attachments are off on this server: it has no file storage. The person who runs this installation turns them on with an S3-compatible bucket (lictory config set S3_BUCKET=… and the other S3_* settings). Until then, link to files instead.";
