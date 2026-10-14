"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import {
  ACCEPT_FILES,
  fileUrl,
  listFiles,
  removeFile,
  uploadFile,
  type FileContext,
  type FileEntry,
} from "./file-upload";

// Last known list per item: a revisit renders it at once and refreshes after.
const known = new Map<string, FileEntry[]>();

export function Attachments({
  context,
  userId,
}: {
  context: FileContext;
  userId: string;
}) {
  const key = `${context.organizationId}:${context.workItemId}`;
  const [files, setState] = useState<FileEntry[]>(() => known.get(key) ?? []);
  const setFiles = useCallback(
    (update: FileEntry[] | ((current: FileEntry[]) => FileEntry[])) =>
      setState((current) => {
        const next = typeof update === "function" ? update(current) : update;
        known.set(key, next);
        return next;
      }),
    [key],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => {
      void listFiles(context)
        .then(setFiles)
        .catch((e: unknown) =>
          setError(
            e instanceof Error ? e.message : "Attachments could not be loaded.",
          ),
        );
    };
    const uploaded = (event: Event) => {
      if ((event as CustomEvent<string>).detail === context.workItemId)
        refresh();
    };
    refresh();
    window.addEventListener("lictory:file-uploaded", uploaded);
    return () => window.removeEventListener("lictory:file-uploaded", uploaded);
  }, [context.organizationId, context.workItemId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add(incoming: FileList | File[]) {
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(incoming)) await uploadFile(file, context);
      setFiles(await listFiles(context));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section
      className="mt-8 border-t pt-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add(e.dataTransfer.files);
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="size-4" /> Attachments
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted disabled:opacity-50"
        >
          <Upload className="size-3.5" /> {busy ? "Uploading…" : "Add files"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_FILES}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void add(e.target.files);
        }}
      />
      {error && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {files.length ? (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <a
                className="min-w-0 flex-1 truncate text-primary hover:underline"
                href={`${fileUrl(file.id)}?download=1`}
              >
                {file.filename}
              </a>
              <span className="text-xs text-muted-foreground">
                {Math.ceil(file.size / 1024)} KB
              </span>
              {file.createdById === userId && (
                <button
                  type="button"
                  aria-label={`Remove ${file.filename}`}
                  className="rounded p-1 hover:bg-muted"
                  onClick={async () => {
                    try {
                      await removeFile(file.id, context.organizationId);
                      setFiles((current) =>
                        current.filter((x) => x.id !== file.id),
                      );
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not remove file.",
                      );
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          Drop files here, or use Add files.
        </p>
      )}
    </section>
  );
}
