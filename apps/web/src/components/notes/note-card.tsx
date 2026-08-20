"use client";

import type { NoteSummary } from "@lictory/contracts";
import { motion } from "motion/react";
import {
  AudioLines,
  FileText,
  GitBranch,
  ImageIcon,
  Pin,
  TriangleAlert,
} from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import {
  RevealItem,
  RevealStagger,
  ScanBeam,
  ShimmerText,
  StatusOrb,
  ThinkingDots,
} from "@/components/ai/primitives";
import { EntityChip } from "@/components/entities/entity-chip";
import { NOTE_STATUS_META, relativeTime } from "@/lib/entities";
import { cn } from "@/lib/utils";

function CountPill({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof ImageIcon;
  value: number;
  label: string;
}) {
  if (value === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[0.6875rem] tabular-nums text-subtle"
      title={`${value} ${label}`}
    >
      <Icon className="size-3" />
      {value}
    </span>
  );
}

export function NoteCard({ note }: { note: NoteSummary }) {
  const status = NOTE_STATUS_META[note.status];
  const busy = note.status === "processing" || note.status === "queued";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-hairline bg-surface transition-colors duration-200",
        "hover:border-hairline-strong hover:bg-surface-strong",
        busy && "ai-active",
        note.status === "failed" && "border-[rgb(var(--danger)/0.3)]",
      )}
    >
      {busy ? <ScanBeam /> : null}

      <Link
        href={`/app/notes/${note.id}`}
        className="relative block p-5 outline-none"
      >
        <header className="mb-2 flex items-center gap-2">
          <StatusOrb state={status.orb} />
          <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-subtle">
            {busy ? <ShimmerText>{status.label}</ShimmerText> : status.label}
          </span>
          {busy ? <ThinkingDots /> : null}
          {note.pinned ? (
            <Pin className="size-3 fill-current text-ember" />
          ) : null}
          <span className="ml-auto text-[0.6875rem] tabular-nums text-subtle">
            {relativeTime(note.createdAt)}
          </span>
        </header>

        <h3 className="mb-1.5 text-balance text-[0.9375rem] font-semibold leading-snug tracking-tight text-foreground">
          {note.title ?? (
            <span className="text-muted">
              {busy ? "Finishing up…" : "Untitled note"}
            </span>
          )}
        </h3>

        {note.status === "failed" && note.aiError ? (
          <p className="mb-3 flex items-start gap-1.5 text-xs leading-relaxed text-danger">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {note.aiError}
          </p>
        ) : (
          <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-muted">
            {note.aiSummary ?? (note.excerpt || "No text yet.")}
          </p>
        )}

        {note.highlights.length > 0 ? (
          <RevealStagger className="mb-3 flex flex-wrap gap-1.5">
            {note.highlights.map((highlight) => (
              <RevealItem key={`${highlight.id}-${highlight.type}`}>
                <EntityChip
                  entity={highlight}
                  status={highlight.status}
                  origin="ai"
                  size="sm"
                  href={null}
                />
              </RevealItem>
            ))}
          </RevealStagger>
        ) : null}

        <footer className="flex items-center gap-3">
          <CountPill
            icon={ImageIcon}
            value={note.counts.images}
            label="images"
          />
          <CountPill
            icon={AudioLines}
            value={note.counts.audio}
            label="clips"
          />
          <CountPill
            icon={FileText}
            value={note.counts.documents}
            label="documents"
          />
          <CountPill
            icon={GitBranch}
            value={note.counts.links}
            label="linked notes"
          />
        </footer>
      </Link>
    </motion.article>
  );
}

export function NoteCardSkeleton() {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-5">
      <div className="skeleton-shimmer mb-3 h-3 w-24 rounded-full" />
      <div className="skeleton-shimmer mb-2 h-4 w-3/5 rounded-full" />
      <div className="skeleton-shimmer mb-1.5 h-3 w-full rounded-full" />
      <div className="skeleton-shimmer mb-4 h-3 w-4/5 rounded-full" />
      <div className="flex gap-1.5">
        <div className="skeleton-shimmer h-5 w-20 rounded-full" />
        <div className="skeleton-shimmer h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}
