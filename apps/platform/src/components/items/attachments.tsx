import { useCallback, useEffect, useRef, useState } from "react";
import {
  File as FileIcon,
  FileImage,
  FileText,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";

// A file's kind at a glance, from its name.
function iconFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
    return FileImage;
  if (["pdf", "md", "txt", "doc", "docx"].includes(ext)) return FileText;
  return FileIcon;
}
import {
  ACCEPT_FILES,
  fileUrl,
  listFiles,
  removeFile,
  uploadFile,
  type FileContext,
  type FileEntry,
} from "@lictory/platform/components/items/file-upload";
import { useAttachmentsAvailable } from "@lictory/platform/lib/session";

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
  const available = useAttachmentsAvailable();
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
      className="mt-10"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (available) void add(e.dataTransfer.files);
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionLabel className="flex items-center gap-1.5">
          <Paperclip aria-hidden className="size-3.5" /> Attachments
          {files.length > 0 && (
            <span className="tabular-nums">· {files.length}</span>
          )}
        </SectionLabel>
        {available && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-3.5" /> {busy ? "Uploading…" : "Add files"}
          </Button>
        )}
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
      {!available && (
        <p className="mb-2 text-xs text-muted-foreground">
          Attachments are unavailable: this server has no file storage
          configured. Ask an administrator to configure S3-compatible storage.
        </p>
      )}
      {files.length ? (
        // Files sit as cards in a tray, like the rest of the item's evidence.
        <ul className="space-y-1 rounded-[1.25rem] bg-tray p-1.5 ring-1 ring-border/70 ring-inset">
          {files.map((file) => {
            const Icon = iconFor(file.filename);
            return (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-[13px] shadow-(--shadow-border)"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <Icon aria-hidden className="size-4" />
                </span>
                <a
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                  href={`${fileUrl(file.id)}?download=1`}
                >
                  {file.filename}
                </a>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {Math.ceil(file.size / 1024)} KB
                </span>
                {file.createdById === userId && (
                  <button
                    type="button"
                    aria-label={`Remove ${file.filename}`}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
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
            );
          })}
        </ul>
      ) : (
        available && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-[1.25rem] border border-dashed px-4 py-5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
          >
            <Upload aria-hidden className="size-3.5" /> Drop files here, or
            choose files
          </button>
        )
      )}
    </section>
  );
}
