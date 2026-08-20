"use client";

import type {
  NoteStatus,
  ProcessingStage,
  ProcessingStep,
} from "@lictory/contracts";
import { motion } from "motion/react";
import {
  AudioLines,
  Check,
  Eye,
  GitBranch,
  Network,
  Sparkles,
  TriangleAlert,
  type IconComponent,
} from "@/components/ui/icons";
import * as React from "react";

import {
  ScanBeam,
  ShimmerText,
  ThinkingDots,
} from "@/components/ai/primitives";
import { cn } from "@/lib/utils";

const STAGE_META: Record<
  ProcessingStage,
  { label: string; icon: IconComponent; description: string }
> = {
  transcribe: {
    label: "Preparing audio",
    icon: AudioLines,
    description: "Turning your recordings into text",
  },
  describe: {
    label: "Preparing files",
    icon: Eye,
    description: "Reading your photos and documents",
  },
  extract: {
    label: "Finding details",
    icon: Sparkles,
    description: "Finding people, places and moments",
  },
  resolve: {
    label: "Organising",
    icon: Network,
    description: "Matching them to what you already know",
  },
  connect: {
    label: "Connecting",
    icon: GitBranch,
    description: "Linking this to your other notes",
  },
};

const ORDER: ProcessingStage[] = [
  "transcribe",
  "describe",
  "extract",
  "resolve",
  "connect",
];

export function ProcessingPipeline({
  steps,
  status,
  className,
}: {
  steps: ProcessingStep[];
  status: NoteStatus;
  className?: string;
}) {
  const byStage = new Map(steps.map((step) => [step.stage, step]));
  const ordered = ORDER.map((stage) => byStage.get(stage)).filter(
    (step): step is ProcessingStep => Boolean(step),
  );

  if (ordered.length === 0) {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-hairline bg-surface px-4 py-3.5 text-sm text-muted",
          className,
        )}
      >
        <ScanBeam />
        <span className="relative inline-flex items-center gap-2">
          <ShimmerText>Getting things ready</ShimmerText>
          <ThinkingDots />
        </span>
      </div>
    );
  }

  const completed = ordered.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const progress = Math.round((completed / ordered.length) * 100);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-hairline bg-surface p-4",
        status === "processing" && "ai-active",
        className,
      )}
    >
      {status === "processing" ? <ScanBeam /> : null}

      <div className="relative mb-3.5 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">
          {status === "failed" ? "Couldn’t finish" : "Finishing your note"}
        </p>
        <span className="font-mono text-[0.6875rem] tabular-nums text-subtle">
          {progress}%
        </span>
      </div>

      <div className="relative mb-4 h-0.5 overflow-hidden bg-[rgb(var(--hairline)/0.12)]">
        <motion.div
          className="h-full bg-ember"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 160, damping: 26 }}
        />
      </div>

      <ol className="relative flex flex-col gap-0.5">
        {ordered.map((step, index) => {
          const meta = STAGE_META[step.stage];
          const Icon = meta.icon;
          const running = step.status === "running";
          const done = step.status === "completed";
          const skipped = step.status === "skipped";
          const failed = step.status === "failed";

          return (
            <motion.li
              key={step.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
              className="relative flex items-start gap-3 py-1.5"
            >
              {index < ordered.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[0.6875rem] top-7 h-[calc(100%-0.5rem)] w-px",
                    done ? "bg-[rgb(var(--success)/0.4)]" : "bg-hairline",
                  )}
                />
              ) : null}

              <span
                className={cn(
                  "relative z-10 flex size-[1.375rem] shrink-0 items-center justify-center rounded-full border transition-colors",
                  done &&
                    "border-[rgb(var(--success)/0.45)] bg-[rgb(var(--success)/0.15)] text-success",
                  running &&
                    "border-[rgb(var(--ember)/0.6)] bg-[rgb(var(--ember)/0.18)] text-ember-bright",
                  failed &&
                    "border-[rgb(var(--danger)/0.5)] bg-[rgb(var(--danger)/0.15)] text-danger",
                  !done && !running && !failed && "border-hairline text-subtle",
                )}
              >
                {running ? (
                  <motion.span
                    className="absolute inset-0 rounded-full border border-[rgb(var(--ember)/0.6)]"
                    animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                ) : null}
                {done ? (
                  <Check className="size-3" />
                ) : failed ? (
                  <TriangleAlert className="size-3" />
                ) : (
                  <Icon className={cn("size-3", skipped && "opacity-40")} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[0.8125rem] font-medium leading-5",
                    skipped ? "text-subtle line-through" : "text-foreground",
                  )}
                >
                  {running ? (
                    <ShimmerText>{meta.label}</ShimmerText>
                  ) : (
                    meta.label
                  )}
                  {running ? <ThinkingDots className="ml-2" /> : null}
                </p>
                <p className="truncate text-xs text-subtle">
                  {step.detail ?? meta.description}
                </p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
