"use client";

import type { Attachment } from "@lictory/contracts";
import { motion } from "motion/react";
import {
  AudioLines,
  FileText,
  ImageIcon,
  Loader,
  Pause,
  Play,
  TriangleAlert,
  X,
} from "@/components/ui/icons";
import * as React from "react";
import WaveSurfer from "wavesurfer.js";

import { ShimmerText } from "@/components/ai/primitives";
import { Button } from "@/components/ui/button";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

export type AttachmentLike = {
  id: string;
  kind: Attachment["kind"];
  fileName: string;
  bytes: number;
  contentType: string;
  durationSeconds?: number | null;
  status: Attachment["status"] | "uploading" | "failed_upload";
  aiResult?: string | null;
  failureReason?: string | null;
  /** Local object URL while drafting, signed URL once persisted. */
  url?: string | null;
  progress?: number;
};

const KIND_ICON = {
  image: ImageIcon,
  audio: AudioLines,
  document: FileText,
} as const;

/**
 * One attachment, in the two places attachments appear: the composer (where it
 * shows upload progress) and the note detail (where it shows what the AI heard
 * or saw).
 */
export function AttachmentTile({
  attachment,
  onRemove,
  compact = false,
}: {
  attachment: AttachmentLike;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const Icon = KIND_ICON[attachment.kind];
  const uploading = attachment.status === "uploading";
  const failed =
    attachment.status === "failed" || attachment.status === "failed_upload";
  const analysing = attachment.status === "processing";

  if (attachment.kind === "image") {
    return (
      <motion.figure
        layout
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        className={cn(
          "group relative overflow-hidden rounded-md border border-hairline bg-surface",
          compact ? "size-14 shrink-0" : "aspect-square w-full",
        )}
      >
        {attachment.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.url}
            alt={attachment.aiResult ?? attachment.fileName}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-subtle">
            <Icon className="size-5" />
          </div>
        )}

        {uploading ? (
          <div className="absolute inset-0 flex items-end bg-black/50 p-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
              <motion.div
                className="h-full bg-ember"
                animate={{
                  width: `${Math.round((attachment.progress ?? 0) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {analysing ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader className="size-4 animate-spin text-ember-bright" />
          </div>
        ) : null}

        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${attachment.fileName}`}
            className={cn(
              "absolute rounded-full bg-black/70 text-white transition-opacity",
              compact
                ? "right-0.5 top-0.5 p-0.5 opacity-100"
                : "right-1.5 top-1.5 p-1 opacity-0 group-hover:opacity-100",
            )}
          >
            <X className="size-3" />
          </button>
        ) : null}

        {!compact && attachment.aiResult ? (
          <figcaption className="absolute inset-x-0 bottom-0 bg-black/80 p-3 text-[0.6875rem] leading-snug text-white/85">
            <span className="line-clamp-3">{attachment.aiResult}</span>
          </figcaption>
        ) : null}
      </motion.figure>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <AudioTile
        attachment={attachment}
        onRemove={onRemove}
        compact={compact}
      />
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn(
        "group flex items-center rounded-md border border-hairline bg-surface",
        compact ? "w-48 shrink-0 gap-2 p-2" : "gap-3 p-3",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border border-hairline-strong bg-surface-strong text-subtle",
          compact ? "size-7" : "size-9",
        )}
      >
        {uploading ? (
          <Loader className="size-4 animate-spin" />
        ) : failed ? (
          <TriangleAlert className="size-4 text-danger" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] font-medium text-foreground">
          {attachment.fileName}
        </p>
        <p className="truncate text-xs text-subtle">
          {analysing ? (
            <ShimmerText>Preparing this document…</ShimmerText>
          ) : failed ? (
            (attachment.failureReason ?? "Could not be processed")
          ) : (
            formatBytes(attachment.bytes)
          )}
        </p>
        {uploading && !compact ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[rgb(var(--hairline)/0.14)]">
            <motion.div
              className="h-full bg-ember"
              animate={{
                width: `${Math.round((attachment.progress ?? 0) * 100)}%`,
              }}
            />
          </div>
        ) : null}
      </div>
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove ${attachment.fileName}`}
        >
          <X />
        </Button>
      ) : null}
    </motion.div>
  );
}

function AudioTile({
  attachment,
  onRemove,
  compact,
}: {
  attachment: AttachmentLike;
  onRemove?: () => void;
  compact: boolean;
}) {
  const waveformRef = React.useRef<HTMLDivElement>(null);
  const waveSurferRef = React.useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const uploading = attachment.status === "uploading";
  const analysing = attachment.status === "processing";

  React.useEffect(() => {
    const container = waveformRef.current;
    if (!container || !attachment.url) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const hairline = rootStyles.getPropertyValue("--hairline").trim();
    const ember = rootStyles.getPropertyValue("--ember").trim();
    const waveSurfer = WaveSurfer.create({
      container,
      url: attachment.url,
      height: compact ? 24 : 32,
      waveColor: `rgb(${hairline} / 0.2)`,
      progressColor: `rgb(${ember})`,
      cursorWidth: 0,
      barWidth: compact ? 2 : 3,
      barGap: 2,
      barRadius: 999,
      barMinHeight: 2,
      normalize: true,
      dragToSeek: true,
    });
    waveSurferRef.current = waveSurfer;

    waveSurfer.on("ready", () => setReady(true));
    waveSurfer.on("play", () => setPlaying(true));
    waveSurfer.on("pause", () => setPlaying(false));
    waveSurfer.on("finish", () => setPlaying(false));
    waveSurfer.on("error", () => setReady(false));

    return () => {
      waveSurfer.destroy();
      waveSurferRef.current = null;
    };
  }, [attachment.url, compact]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn(
        "shrink-0 rounded-md border border-hairline bg-surface",
        compact ? "w-56 p-2" : "p-3",
      )}
    >
      <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
        <button
          type="button"
          disabled={!attachment.url || !ready}
          onClick={() => {
            void waveSurferRef.current?.playPause();
          }}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-surface-strong text-foreground transition-colors hover:border-[rgb(var(--ember)/0.5)] disabled:opacity-40",
            compact ? "size-7" : "size-9",
          )}
        >
          {uploading ? (
            <Loader className="size-3.5 animate-spin" />
          ) : playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5 translate-x-px" />
          )}
        </button>

        <div
          ref={waveformRef}
          tabIndex={ready ? 0 : -1}
          aria-label={`Waveform for ${attachment.fileName}. Use left and right arrows to seek.`}
          onKeyDown={(event) => {
            const waveSurfer = waveSurferRef.current;
            if (!waveSurfer) return;
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              void waveSurfer.playPause();
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              waveSurfer.skip(-5);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              waveSurfer.skip(5);
            }
          }}
          className={cn(
            "min-w-0 flex-1 overflow-hidden rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ember)/0.65)]",
            compact ? "h-6" : "h-8",
          )}
        />

        <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">
          {attachment.durationSeconds
            ? formatDuration(attachment.durationSeconds)
            : formatBytes(attachment.bytes)}
        </span>

        {onRemove ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={`Remove ${attachment.fileName}`}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {uploading && !compact ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[rgb(var(--hairline)/0.14)]">
          <motion.div
            className="h-full bg-ember"
            animate={{
              width: `${Math.round((attachment.progress ?? 0) * 100)}%`,
            }}
          />
        </div>
      ) : null}

      {!compact && analysing ? (
        <p className="mt-2 text-xs">
          <ShimmerText>Transcribing this clip…</ShimmerText>
        </p>
      ) : !compact && attachment.aiResult ? (
        <p className="mt-2 border-l-2 border-[rgb(var(--ember)/0.4)] pl-2.5 text-xs leading-relaxed text-muted">
          “{attachment.aiResult}”
        </p>
      ) : null}
    </motion.div>
  );
}
