"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Camera,
  CircleStop,
  FileUp,
  Mic,
  Paperclip,
  Trash2,
  X,
} from "@/components/ui/icons";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  ComposerCamera,
  type ComposerCameraHandle,
} from "@/components/notes/composer-camera";
import {
  AttachmentTile,
  type AttachmentLike,
} from "@/components/notes/attachment-tile";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  KEYBINDINGS,
  Keybinding,
  keybindingAria,
  matchesKeybinding,
} from "@/components/ui/keybinding";
import { useApi } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";

type Draft = AttachmentLike & {
  localId: string;
  file: File;
  remoteId?: string;
};

const FILE_ACCEPT =
  "image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.rtf,application/pdf,text/plain,text/markdown,text/csv";
const WAVEFORM_BARS = 52;
const LONG_PRESS_MS = 420;

function kindFor(type: string): AttachmentLike["kind"] {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  return "document";
}

function preferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  return (
    candidates.find((type) => MediaRecorder.isTypeSupported(type)) ??
    "audio/webm"
  );
}

function useWaveformRecorder(
  onComplete: (file: File, durationSeconds: number) => void,
) {
  const [status, setStatus] = React.useState<"idle" | "starting" | "recording">(
    "idle",
  );
  const [seconds, setSeconds] = React.useState(0);
  const [levels, setLevels] = React.useState<number[]>(() =>
    Array.from({ length: WAVEFORM_BARS }, () => 0.06),
  );
  const [error, setError] = React.useState<string | null>(null);

  const streamRef = React.useRef<MediaStream | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  const frameRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = React.useRef(0);
  const stopWhenReadyRef = React.useRef(false);

  const teardown = React.useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    recorderRef.current = null;
  }, []);

  React.useEffect(() => () => teardown(), [teardown]);

  const start = React.useCallback(async () => {
    if (recorderRef.current || status !== "idle") return;
    setError(null);
    setStatus("starting");
    stopWhenReadyRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const sample = () => {
        analyser.getByteTimeDomainData(buffer);
        let peak = 0;
        for (const value of buffer) {
          peak = Math.max(peak, Math.abs(value - 128) / 128);
        }
        setLevels((current) => [
          ...current.slice(1),
          Math.max(0.06, Math.min(1, peak * 1.9)),
        ]);
        frameRef.current = requestAnimationFrame(sample);
      };
      frameRef.current = requestAnimationFrame(sample);

      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const extension = mimeType.includes("mp4")
          ? "m4a"
          : mimeType.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(
          [blob],
          `voice-note-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extension}`,
          { type: mimeType.split(";")[0] },
        );
        const duration = secondsRef.current;
        teardown();
        setStatus("idle");
        setSeconds(0);
        setLevels(Array.from({ length: WAVEFORM_BARS }, () => 0.06));
        if (blob.size > 0) onComplete(file, duration);
      };

      secondsRef.current = 0;
      setSeconds(0);
      recorder.start(250);
      setStatus("recording");
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1_000);

      if (stopWhenReadyRef.current) recorder.stop();
    } catch {
      teardown();
      setStatus("idle");
      setError(
        "Microphone access is blocked. You can still add an audio file.",
      );
    }
  }, [onComplete, status, teardown]);

  const stop = React.useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    stopWhenReadyRef.current = true;
  }, []);

  return {
    active: status !== "idle",
    status,
    seconds,
    levels,
    error,
    start,
    stop,
  };
}

function WaveformOverlay({
  levels,
  seconds,
  starting,
}: {
  levels: number[];
  seconds: number;
  starting: boolean;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgb(var(--ember)/0.13),transparent_68%)] px-6 pb-16">
      <div className="mb-7 flex items-center gap-2 text-sm font-medium text-foreground">
        <span className="size-2 animate-pulse rounded-full bg-danger" />
        {starting ? "Opening microphone…" : "Recording"}
        <span className="font-mono tabular-nums text-muted">
          {formatDuration(seconds)}
        </span>
      </div>
      <div className="flex h-24 w-full max-w-2xl items-center gap-[3px]">
        {levels.map((level, index) => (
          <motion.span
            key={index}
            className="min-h-1 w-full rounded-full bg-ember"
            animate={{ height: `${Math.round(level * 100)}%` }}
            transition={{ duration: 0.1 }}
          />
        ))}
      </div>
      <p className="mt-6 text-xs text-subtle">
        Tap Stop when finished · hold Record to capture while pressed
      </p>
    </div>
  );
}

export function NoteComposer({
  onCreated,
  className,
}: {
  onCreated?: (noteId: string) => void;
  className?: string;
}) {
  const api = useApi();
  const pathname = usePathname();
  const router = useRouter();

  const [body, setBody] = React.useState("");
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const noteIdRef = React.useRef<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<ComposerCameraHandle>(null);
  const pressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const longPressRef = React.useRef(false);

  const ensureNote = React.useCallback(async () => {
    if (noteIdRef.current) return noteIdRef.current;
    const { note } = await api.createNote({});
    noteIdRef.current = note.id;
    return note.id;
  }, [api]);

  const updateDraft = React.useCallback(
    (localId: string, patch: Partial<Draft>) => {
      setDrafts((current) =>
        current.map((draft) =>
          draft.localId === localId ? { ...draft, ...patch } : draft,
        ),
      );
    },
    [],
  );

  const addFiles = React.useCallback(
    async (files: File[], durationSeconds?: number) => {
      const accepted = files.filter((file) => {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} is larger than 50 MB`);
          return false;
        }
        return true;
      });
      if (accepted.length === 0) return;

      const newDrafts: Draft[] = accepted.map((file) => ({
        localId: crypto.randomUUID(),
        file,
        id: "",
        kind: kindFor(file.type),
        fileName: file.name,
        bytes: file.size,
        contentType: file.type || "application/octet-stream",
        durationSeconds: durationSeconds ?? null,
        status: "uploading",
        progress: 0,
        url:
          file.type.startsWith("image/") || file.type.startsWith("audio/")
            ? URL.createObjectURL(file)
            : null,
      }));
      setDrafts((current) => [...current, ...newDrafts]);

      const noteId = await ensureNote().catch((error: Error) => {
        toast.error(error.message);
        return null;
      });
      if (!noteId) {
        setDrafts((current) =>
          current.map((draft) =>
            newDrafts.some((item) => item.localId === draft.localId)
              ? { ...draft, status: "failed_upload" }
              : draft,
          ),
        );
        return;
      }

      await Promise.all(
        newDrafts.map(async (draft) => {
          try {
            const attachment = await api.uploadAttachment(
              noteId,
              {
                fileName: draft.fileName,
                contentType: draft.contentType,
                bytes: draft.bytes,
                durationSeconds: draft.durationSeconds ?? undefined,
                body: draft.file,
              },
              (progress) =>
                updateDraft(draft.localId, {
                  progress: progress.total
                    ? progress.loaded / progress.total
                    : 0,
                }),
            );
            updateDraft(draft.localId, {
              status: "uploaded",
              progress: 1,
              remoteId: attachment.id,
              id: attachment.id,
            });
          } catch (error) {
            updateDraft(draft.localId, { status: "failed_upload" });
            toast.error(
              error instanceof Error
                ? error.message
                : `${draft.fileName} could not be uploaded`,
            );
          }
        }),
      );
    },
    [api, ensureNote, updateDraft],
  );

  const onRecordingComplete = React.useCallback(
    (file: File, duration: number) => void addFiles([file], duration),
    [addFiles],
  );
  const audio = useWaveformRecorder(onRecordingComplete);

  const removeDraft = async (draft: Draft) => {
    setDrafts((current) =>
      current.filter((item) => item.localId !== draft.localId),
    );
    if (draft.url?.startsWith("blob:")) URL.revokeObjectURL(draft.url);
    if (draft.remoteId && noteIdRef.current) {
      await api
        .deleteAttachment(noteIdRef.current, draft.remoteId)
        .catch(() => undefined);
    }
  };

  const uploading = drafts.some((draft) => draft.status === "uploading");
  const hasContent = body.trim().length > 0 || drafts.length > 0;

  const submit = React.useCallback(async () => {
    if (!hasContent || uploading || audio.active || cameraOpen) return;
    setSubmitting(true);
    try {
      const noteId = await ensureNote();
      await api.updateNote(noteId, { bodyMarkdown: body });
      await api.processNote(noteId);
      toast.success("Note saved");
      noteIdRef.current = null;
      setBody("");
      drafts.forEach((draft) => {
        if (draft.url?.startsWith("blob:")) URL.revokeObjectURL(draft.url);
      });
      setDrafts([]);
      if (onCreated) onCreated(noteId);
      else router.push(`/app/notes/${noteId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save this note",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    api,
    audio.active,
    body,
    cameraOpen,
    drafts,
    ensureNote,
    hasContent,
    onCreated,
    router,
    uploading,
  ]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (matchesKeybinding(event, KEYBINDINGS.save)) {
        event.preventDefault();
        void submit();
        return;
      }

      if (matchesKeybinding(event, KEYBINDINGS.record)) {
        event.preventDefault();
        if (cameraOpen) return;
        if (audio.active) audio.stop();
        else void audio.start();
        return;
      }

      if (event.key === "Escape") {
        if (audio.active) {
          event.preventDefault();
          audio.stop();
        } else if (cameraOpen) {
          event.preventDefault();
          setCameraOpen(false);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audio, cameraOpen, submit]);

  const discard = async () => {
    const noteId = noteIdRef.current;
    setBody("");
    drafts.forEach((draft) => {
      if (draft.url?.startsWith("blob:")) URL.revokeObjectURL(draft.url);
    });
    setDrafts([]);
    noteIdRef.current = null;
    if (noteId) await api.deleteNote(noteId).catch(() => undefined);
  };

  const images = drafts.filter((draft) => draft.kind === "image");
  const otherFiles = drafts.filter((draft) => draft.kind !== "image");
  const captureActive = audio.active || cameraOpen;

  const floatingToolbar = (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-hairline-strong bg-[rgb(var(--canvas)/0.88)] p-1.5 shadow-[0_12px_36px_rgb(0_0_0/0.32)] backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Button
        variant={audio.active ? "danger" : "ghost"}
        size="sm"
        disabled={cameraOpen}
        aria-label={audio.active ? "Stop recording" : "Record audio"}
        aria-pressed={audio.active}
        aria-keyshortcuts={keybindingAria(KEYBINDINGS.record)}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          longPressRef.current = false;
          if (audio.active) return;
          pressTimerRef.current = setTimeout(() => {
            longPressRef.current = true;
            void audio.start();
          }, LONG_PRESS_MS);
        }}
        onPointerUp={() => {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
          if (audio.active || longPressRef.current) {
            audio.stop();
          } else {
            void audio.start();
          }
        }}
        onPointerCancel={() => {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
          pressTimerRef.current = null;
          if (longPressRef.current) audio.stop();
        }}
        onClick={(event) => {
          if (event.detail !== 0) return;
          if (audio.active) audio.stop();
          else void audio.start();
        }}
      >
        {audio.active ? <CircleStop /> : <Mic />}
        {audio.active ? "Stop" : "Record"}
        <Keybinding
          binding={KEYBINDINGS.record}
          tone={audio.active ? "inverse" : "default"}
          className="hidden sm:inline-flex"
        />
      </Button>

      <Button
        variant={cameraOpen ? "primary" : "ghost"}
        size="sm"
        disabled={audio.active}
        onClick={() => {
          if (cameraOpen) cameraRef.current?.capture();
          else setCameraOpen(true);
        }}
      >
        <Camera />
        {cameraOpen ? "Take photo" : "Camera"}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={captureActive}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileUp />
        Add files
      </Button>

      {cameraOpen ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCameraOpen(false)}
          aria-label="Close camera"
        >
          <X />
        </Button>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-hairline-strong bg-canvas-raised shadow-[0_24px_80px_rgb(0_0_0/0.18)]",
        className,
      )}
    >
      <MarkdownEditor
        value={body}
        onChange={setBody}
        onFilesDropped={(files) => void addFiles(files)}
        minRows={9}
        autoFocus={pathname === "/app"}
        className="rounded-none border-0 bg-transparent focus-within:border-transparent"
        emptyState={
          <div>
            <p className="font-medium text-muted">Start writing anywhere.</p>
            <p className="mt-1 max-w-md">
              Or drop a file here, record a thought, take a photo, or add
              something from your device.
            </p>
          </div>
        }
        floatingToolbar={floatingToolbar}
        overlay={
          audio.active ? (
            <WaveformOverlay
              levels={audio.levels}
              seconds={audio.seconds}
              starting={audio.status === "starting"}
            />
          ) : cameraOpen ? (
            <ComposerCamera
              ref={cameraRef}
              active
              onCapture={(file) => {
                void addFiles([file]);
                setCameraOpen(false);
              }}
            />
          ) : null
        }
      />

      {audio.error ? (
        <p className="border-t border-hairline px-5 py-3 text-xs text-danger">
          {audio.error}
        </p>
      ) : null}

      {images.length > 0 || otherFiles.length > 0 ? (
        <div className="border-t border-hairline px-4 py-3 sm:px-5">
          <motion.div
            layout
            className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <AnimatePresence mode="popLayout">
              {[...images, ...otherFiles].map((draft) => (
                <AttachmentTile
                  key={draft.localId}
                  attachment={draft}
                  onRemove={() => void removeDraft(draft)}
                  compact
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-t border-hairline px-4 py-3 sm:px-5">
        <p className="min-w-0 flex-1 text-xs text-subtle" aria-live="polite">
          {uploading ? (
            "Uploading…"
          ) : drafts.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <Paperclip className="size-3" />
              {drafts.length} attached
            </span>
          ) : (
            "Text and attachments stay together"
          )}
        </p>
        {hasContent ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void discard()}
            aria-label="Discard note"
          >
            <Trash2 />
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          loading={submitting}
          disabled={!hasContent || uploading || captureActive}
          aria-keyshortcuts={keybindingAria(KEYBINDINGS.save)}
        >
          {!submitting ? <ArrowUpRight /> : null}
          Save
          <Keybinding
            binding={KEYBINDINGS.save}
            tone="inverse"
            className="hidden sm:inline-flex"
          />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
