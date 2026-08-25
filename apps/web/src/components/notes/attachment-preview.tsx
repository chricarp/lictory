"use client";

import { motion } from "motion/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  TriangleAlert,
  X,
} from "@/components/ui/icons";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { getFilePresentation } from "@/lib/file-presentation";
import { isPreviewableDocument, toDownloadUrl } from "@/lib/media";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { AttachmentLike } from "@/components/notes/attachment-tile";

/**
 * Full-size view of one attachment, with the rest of the note's attachments a
 * keystroke away. Every kind gets the largest rendition the browser can manage
 * — image, audio player, embedded document — and every kind gets a download,
 * because "the browser cannot show this" must never be a dead end.
 */
export function AttachmentPreview({
  attachments,
  index,
  onIndexChange,
  onClose,
}: {
  attachments: AttachmentLike[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const attachment = index === null ? undefined : attachments[index];
  const hasNeighbours = attachments.length > 1;

  const step = (delta: number) => {
    if (index === null || !hasNeighbours) return;
    const next = (index + delta + attachments.length) % attachments.length;
    onIndexChange(next);
  };

  return (
    <Dialog
      open={attachment !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {attachment ? (
        <DialogContent
          showClose={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-1);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              step(1);
            }
          }}
          className="max-w-4xl gap-0 p-0"
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-hairline px-4 py-3">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-sm">
                {attachment.fileName}
              </DialogTitle>
              <DialogDescription className="truncate text-xs">
                {describe(attachment)}
                {hasNeighbours
                  ? ` · ${(index ?? 0) + 1} of ${attachments.length}`
                  : ""}
              </DialogDescription>
            </div>

            {hasNeighbours ? (
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous attachment"
                  onClick={() => step(-1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next attachment"
                  onClick={() => step(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            ) : null}

            {attachment.url ? (
              <Button
                variant="ghost"
                size="icon-sm"
                asChild
                className="hidden sm:inline-flex"
                aria-label={`Open ${attachment.fileName} in a new tab`}
              >
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
            <AttachmentDownloadButton attachment={attachment} />
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close preview">
                <X />
              </Button>
            </DialogClose>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <PreviewBody key={attachment.id} attachment={attachment} />
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** The one download affordance, so tiles and the preview stay consistent. */
export function AttachmentDownloadButton({
  attachment,
  className,
}: {
  attachment: AttachmentLike;
  className?: string;
}) {
  if (!attachment.url) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      asChild
      className={className}
      aria-label={`Download ${attachment.fileName}`}
      title={`Download ${attachment.fileName}`}
    >
      <a
        href={toDownloadUrl(attachment.url)}
        download={attachment.fileName}
        onClick={(event) => event.stopPropagation()}
      >
        <Download />
      </a>
    </Button>
  );
}

function PreviewBody({ attachment }: { attachment: AttachmentLike }) {
  const [failed, setFailed] = React.useState(false);

  if (!attachment.url || failed) {
    return (
      <Unavailable
        attachment={attachment}
        reason={
          attachment.url
            ? "This link has expired. Refresh the note to get a fresh one."
            : "This file is still uploading."
        }
      />
    );
  }

  if (attachment.kind === "image") {
    return (
      <figure className="flex flex-col">
        <motion.img
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          src={attachment.url}
          alt={attachment.aiResult ?? attachment.fileName}
          onError={() => setFailed(true)}
          className="max-h-[70vh] w-full bg-black/40 object-contain"
        />
        {attachment.aiResult ? (
          <figcaption className="border-t border-hairline px-5 py-4 text-sm leading-relaxed text-muted">
            {attachment.aiResult}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (attachment.kind === "audio") {
    return (
      <div className="px-5 py-6">
        <audio
          src={attachment.url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="w-full"
        />
        {attachment.aiResult ? (
          <p className="mt-5 border-l-2 border-[rgb(var(--ember)/0.4)] pl-3 text-sm leading-relaxed text-muted">
            “{attachment.aiResult}”
          </p>
        ) : null}
      </div>
    );
  }

  if (isPreviewableDocument(attachment.contentType)) {
    return (
      <iframe
        src={attachment.url}
        title={attachment.fileName}
        className="h-[70vh] w-full bg-white"
      />
    );
  }

  return (
    <Unavailable
      attachment={attachment}
      reason="This file type can’t be shown in the browser."
    />
  );
}

function Unavailable({
  attachment,
  reason,
}: {
  attachment: AttachmentLike;
  reason: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <TriangleAlert className="size-5 text-subtle" />
      <p className="text-sm text-muted">{reason}</p>
      {attachment.url ? (
        <Button variant="secondary" size="sm" asChild>
          <a
            href={toDownloadUrl(attachment.url)}
            download={attachment.fileName}
          >
            Download {formatBytes(attachment.bytes)}
          </a>
        </Button>
      ) : null}
      {attachment.aiResult ? (
        <p className="mt-4 max-w-prose whitespace-pre-wrap text-left text-sm leading-relaxed text-muted">
          {attachment.aiResult}
        </p>
      ) : null}
    </div>
  );
}

function describe(attachment: AttachmentLike): string {
  const size = formatBytes(attachment.bytes);
  if (attachment.kind === "audio" && attachment.durationSeconds) {
    return `${formatDuration(attachment.durationSeconds)} · ${size}`;
  }
  if (attachment.kind === "image") return `Image · ${size}`;
  return `${getFilePresentation(attachment.fileName, attachment.contentType).label} · ${size}`;
}
