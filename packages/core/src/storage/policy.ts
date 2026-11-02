// A conservative shared desktop-upload limit. Linear documents 25 MB for email
// intake; Jira's default is larger and administrator-configurable. Browser
// uploads use this one predictable limit until a product policy is introduced.
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

const types: Record<string, string[]> = {
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  bmp: ["image/bmp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  csv: ["text/csv", "application/csv", "application/vnd.ms-excel"],
  doc: ["application/msword"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  zip: ["application/zip", "application/x-zip-compressed"],
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  mp3: ["audio/mpeg"],
};
export const SUPPORTED_FILE_EXTENSIONS = Object.keys(types);
export const ACCEPT_FILES = SUPPORTED_FILE_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");
export function validateFile(filename: string, mimeType: string, size: number) {
  if (!filename || filename.length > 255 || /[\\/\x00-\x1f\x7f]/.test(filename))
    throw new Error("Use a filename without paths or control characters.");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!types[ext]?.includes(mimeType.toLowerCase()))
    throw new Error(
      `This file type is not supported. Allowed types: ${SUPPORTED_FILE_EXTENSIONS.join(", ")}.`,
    );
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_SIZE)
    throw new Error("Files must be between 1 byte and 25 MB.");
}
function checkIdentity(organizationId: string, fileId: string) {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/.test(fileId)
  )
    throw new Error("Invalid object identity.");
}
export function objectKey(organizationId: string, fileId: string) {
  checkIdentity(organizationId, fileId);
  return `organizations/${organizationId}/files/${fileId}`;
}
// Where a removed attachment's bytes are retained. Signed download URLs name
// the object key, so moving the bytes is what makes links issued before the
// removal stop working.
export function removedObjectKey(organizationId: string, fileId: string) {
  checkIdentity(organizationId, fileId);
  return `organizations/${organizationId}/removed-files/${fileId}`;
}
