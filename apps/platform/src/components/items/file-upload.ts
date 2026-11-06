import { z } from "zod";
import {
  ACCEPT_FILES,
  MAX_FILE_SIZE,
  validateFile,
} from "@lictory/core/storage/policy";
export { ACCEPT_FILES, MAX_FILE_SIZE };

// A file belongs to a work item or to a Spaces page.
export type FileContext =
  | { organizationId: string; workItemId: string; pageId?: never }
  | { organizationId: string; pageId: string; workItemId?: never };
export type FileEntry = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdById: string;
};

async function action(body: object): Promise<unknown> {
  const response = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(result);
    throw new Error(
      parsed.success ? parsed.data.error : "File request failed.",
    );
  }
  return result;
}
export async function uploadFile(
  file: File,
  context: FileContext,
): Promise<FileEntry> {
  validateFile(file.name, file.type, file.size);
  const started = z
    .object({
      id: z.string().uuid(),
      uploadUrl: z.string().url(),
      headers: z.record(z.string(), z.string()),
    })
    .parse(
      await action({
        action: "start",
        ...context,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      }),
    );
  const put = await fetch(started.uploadUrl, {
    method: "PUT",
    headers: started.headers,
    body: file,
  });
  if (!put.ok) throw new Error("The file could not be uploaded to storage.");
  await action({
    action: "finish",
    organizationId: context.organizationId,
    id: started.id,
  });
  window.dispatchEvent(
    new CustomEvent("lictory:file-uploaded", {
      detail: context.workItemId ?? context.pageId,
    }),
  );
  return {
    id: started.id,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    createdById: "",
  };
}
export const fileUrl = (id: string) => `/api/files/${id}`;
export function fileMarkdown(file: FileEntry) {
  const label = file.filename.replaceAll("[", "\\[").replaceAll("]", "\\]");
  return `${file.mimeType.startsWith("image/") ? "!" : ""}[${label}](${fileUrl(file.id)})`;
}
export async function listFiles(context: FileContext): Promise<FileEntry[]> {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(context))
    if (typeof value === "string") query.set(name, value);
  const response = await fetch(`/api/files?${query}`);
  if (!response.ok) throw new Error("Attachments could not be loaded.");
  const result: unknown = await response.json();
  return z
    .array(
      z.object({
        id: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        size: z.number(),
        createdById: z.string(),
      }),
    )
    .parse(result);
}
export async function removeFile(id: string, organizationId: string) {
  await action({ action: "remove", id, organizationId });
}
