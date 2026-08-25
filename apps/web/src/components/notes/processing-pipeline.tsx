"use client";

import type {
  NoteStatus,
  ProcessingStage,
  ProcessingStep,
  StageStatus,
} from "@lictory/contracts";
import * as React from "react";

import { ScanBeam, ShimmerText } from "@/components/ai/primitives";
import { cn } from "@/lib/utils";

/** Plain-language name for each stage. Deliberately no per-stage icon:
 *  five different glyphs in a five-row list is noise, not information. */
const STAGE_LABEL: Record<ProcessingStage, string> = {
  transcribe: "Prepared audio",
  describe: "Prepared files",
  extract: "Found details",
  resolve: "Organised context",
  connect: "Connected notes",
};

const ORDER: ProcessingStage[] = [
  "transcribe",
  "describe",
  "extract",
  "resolve",
  "connect",
];

/** Only states the user needs to act on get a word. A completed step
 *  is already obvious from its filled dot. */
const STEP_NOTE: Partial<Record<StageStatus, string>> = {
  pending: "Waiting",
  running: "Working",
  failed: "Failed",
  skipped: "Skipped",
};

type Tone = "active" | "ready" | "failed" | "idle";

/** Spinner → check morph. The arc rotates while work is in flight, then
 *  pops outward as the mark scales in and draws itself, so one object
 *  carries the whole state change instead of two icons swapping. */
function SpinnerCheck({ tone }: { tone: Tone }) {
  const state =
    tone === "active"
      ? "run"
      : tone === "ready"
        ? "done"
        : tone === "failed"
          ? "fail"
          : "idle";

  return (
    <span
      className={cn(
        "t-spincheck size-5",
        tone === "active" && "text-ember-bright",
        tone === "ready" && "text-success",
        tone === "failed" && "text-danger",
        tone === "idle" && "text-subtle",
      )}
      data-state={state}
      aria-hidden
    >
      <svg
        className="t-spincheck-ring size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="9" opacity={0.2} />
        <circle cx="12" cy="12" r="9" strokeDasharray="15 42" />
      </svg>
      <svg
        className="t-spincheck-mark size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === "failed" ? (
          <path d="M12 7v6m0 3.5v.5" />
        ) : tone === "ready" ? (
          <path d="M6 12.5L10.5 17L18 8" />
        ) : (
          <path d="M6 12h12" opacity={0.55} />
        )}
      </svg>
    </span>
  );
}

export function ProcessingPipeline({
  steps,
  status,
  className,
}: {
  steps: ProcessingStep[];
  status: NoteStatus;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();

  const byStage = new Map(steps.map((step) => [step.stage, step]));
  const ordered = ORDER.map((stage) => byStage.get(stage)).filter(
    (step): step is ProcessingStep => Boolean(step),
  );

  const active = status === "processing" || status === "queued";
  const tone: Tone = active
    ? "active"
    : status === "failed"
      ? "failed"
      : status === "ready"
        ? "ready"
        : "idle";

  const settled = ordered.filter(
    (step) => step.status === "completed" || step.status === "skipped",
  ).length;
  const runningStep = ordered.find((step) => step.status === "running");
  const failedStep = ordered.find((step) => step.status === "failed");

  const title = active
    ? status === "queued"
      ? "Understanding queued"
      : (runningStep && STAGE_LABEL[runningStep.stage]) || "Understanding note"
    : status === "failed"
      ? "Understanding stopped"
      : status === "ready"
        ? "Note understood"
        : "Not yet understood";

  const detail = active
    ? (runningStep?.detail ?? "Reading this note and its attachments.")
    : status === "failed"
      ? (failedStep?.detail ?? "Open the steps to see where it stopped.")
      : status === "ready"
        ? "People, places and moments are on this note."
        : "Process this note to build its context.";

  return (
    <div
      className={cn(
        "t-acc relative overflow-hidden rounded-lg border border-hairline bg-surface",
        active && "ai-active",
        className,
      )}
      data-open={open}
    >
      {active ? <ScanBeam /> : null}

      <div className="relative flex items-start gap-3 p-4">
        <span className="mt-px shrink-0">
          <SpinnerCheck tone={tone} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-foreground">
              {active ? <ShimmerText>{title}</ShimmerText> : title}
            </p>
            {ordered.length > 0 ? (
              <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-subtle">
                {settled}/{ordered.length}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-subtle">
            {detail}
          </p>

          {ordered.length > 0 ? (
            <div className="mt-3 flex gap-1" aria-hidden>
              {ordered.map((step) => {
                const fill =
                  step.status === "completed" || step.status === "skipped"
                    ? "full"
                    : step.status === "running"
                      ? "partial"
                      : "none";

                return (
                  <span
                    key={step.id}
                    className="t-rail-seg h-0.5 flex-1 overflow-hidden rounded-full bg-hairline-strong"
                    data-fill={fill}
                  >
                    <span
                      className={cn(
                        "t-rail-fill block h-full w-full rounded-full",
                        step.status === "failed"
                          ? "bg-danger"
                          : step.status === "skipped"
                            ? "bg-subtle"
                            : active
                              ? "bg-ember-bright"
                              : "bg-success",
                      )}
                    />
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="relative flex w-full items-center justify-between gap-2 border-t border-hairline px-4 py-2.5 text-left text-[0.6875rem] font-medium text-subtle transition-colors hover:bg-surface-strong hover:text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{open ? "Hide steps" : "Show steps"}</span>
        <span className="t-acc-chevron" aria-hidden>
          <svg className="size-3.5" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6.5L8 10.5L12 6.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <div className="t-acc-panel" id={panelId} aria-hidden={!open}>
        <div className="t-acc-panel-inner">
          {ordered.length > 0 ? (
            <ol className="border-t border-hairline px-4 py-1">
              {ordered.map((step) => {
                const running = step.status === "running";
                const stepFailed = step.status === "failed";
                const note = STEP_NOTE[step.status];
                // Only unfinished or broken steps earn a second line.
                const showDetail = (running || stepFailed) && step.detail;

                return (
                  <li
                    key={step.id}
                    className="flex items-start gap-2.5 py-2 text-xs"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        step.status === "completed" && "bg-success",
                        running &&
                          "bg-ember-bright motion-safe:animate-breathe",
                        stepFailed && "bg-danger",
                        step.status === "pending" && "bg-hairline-strong",
                        step.status === "skipped" &&
                          "border border-hairline-strong",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span
                          className={cn(
                            "truncate text-foreground",
                            (step.status === "pending" ||
                              step.status === "skipped") &&
                              "text-subtle",
                          )}
                        >
                          {STAGE_LABEL[step.stage]}
                        </span>
                        {note ? (
                          <span
                            className={cn(
                              "shrink-0 text-[0.6875rem] text-subtle",
                              running && "text-ember-bright",
                              stepFailed && "text-danger",
                            )}
                          >
                            {note}
                          </span>
                        ) : null}
                      </span>
                      {showDetail ? (
                        <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-subtle">
                          {step.detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="border-t border-hairline px-4 py-3 text-xs text-subtle">
              Nothing has run yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
