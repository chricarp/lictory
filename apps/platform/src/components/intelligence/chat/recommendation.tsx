"use client";
import { motion, useReducedMotion } from "motion/react";
import { Check, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@lictory/ui/button";
import type {
  RecommendActionInput,
  RecommendActionOutput,
} from "@lictory/core/intelligence/chat/shared";
import { cn } from "@lictory/core/lib/utils";

// A change the assistant proposes on its own initiative. Nothing happens
// until the person accepts it or picks an alternative. Adapted from
// Beautiful UI's Recommendation Card (MIT, beautifului.dev).

type Confidence = RecommendActionInput["confidence"];
const confidence: Record<
  Confidence,
  { bars: number; tone: string; label: string }
> = {
  high: { bars: 3, tone: "bg-success", label: "High confidence" },
  medium: { bars: 2, tone: "bg-warning", label: "Medium confidence" },
  low: { bars: 1, tone: "bg-muted-foreground", label: "Low confidence" },
};

function Meter({ level }: { level: Confidence }) {
  const { bars, tone } = confidence[level];
  return (
    <span className="flex items-end gap-0.5" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className={cn(
            "w-1 rounded-full transition-colors duration-300",
            bar < bars ? tone : "bg-muted-foreground/20",
          )}
          style={{ height: 6 + bar * 2 }}
        />
      ))}
    </span>
  );
}

export function RecommendationCard({
  input,
  onDecide,
}: {
  input: RecommendActionInput;
  onDecide: (output: RecommendActionOutput) => void;
}) {
  const reduce = useReducedMotion();
  // -1 is the recommendation itself; otherwise an alternative's index.
  const [selected, setSelected] = useState(-1);
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);
  const alternatives = input.alternatives;
  const chosen = selected >= 0 ? alternatives[selected] : undefined;
  const level = chosen?.confidence ?? input.confidence;
  const decide = (output: RecommendActionOutput) => {
    setDecided(true);
    onDecide(output);
  };
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", duration: 0.45, bounce: 0.12 }}
      role="group"
      aria-label="Recommendation"
      className="max-w-lg overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--border),0_8px_24px_-14px_oklch(0_0_0/0.25)]"
    >
      <div className="px-4 pt-3.5 pb-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Lightbulb className="size-3.5 text-warning" aria-hidden />
          Recommendation
        </p>
        <p className="mt-1.5 text-[14px] font-medium">{input.question}</p>
        <p
          key={selected}
          className="activity-enter mt-1.5 min-h-10 text-[13px] leading-5 text-foreground/85"
        >
          {chosen ? chosen.label : input.action}
        </p>
        {!chosen && (
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            {input.reason}
          </p>
        )}
      </div>
      {alternatives.length > 0 && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{
            gridTemplateRows: open ? "1fr" : "0fr",
            opacity: open ? 1 : 0,
          }}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t px-2 py-2">
              <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                Other options
              </p>
              {[
                { label: input.action, confidence: input.confidence, i: -1 },
                ...alternatives.map((a, i) => ({ ...a, i })),
              ]
                .filter((o) => o.i !== selected)
                .map((o) => (
                  <button
                    key={o.i}
                    type="button"
                    onClick={() => {
                      setSelected(o.i);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-muted"
                  >
                    <Meter level={o.confidence} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      {o.i === -1 ? `Recommended: ${o.label}` : o.label}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {confidence[o.confidence].label}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
        <span className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <Meter level={level} />
          {confidence[level].label}
        </span>
        <span className="flex items-center gap-1.5">
          {alternatives.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={open}
              disabled={decided}
              onClick={() => setOpen((o) => !o)}
              className="rounded-full px-3 active:scale-[0.97]"
            >
              Alternatives
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={decided}
            onClick={() => decide({ decision: "declined", choice: null })}
            className="rounded-full px-3 active:scale-[0.97]"
          >
            Not now
          </Button>
          <Button
            size="sm"
            disabled={decided}
            onClick={() =>
              decide(
                chosen
                  ? { decision: "alternative", choice: chosen.label }
                  : { decision: "accepted", choice: null },
              )
            }
            className="rounded-full px-3 active:scale-[0.97]"
          >
            {chosen ? "Use this" : "Accept"}
          </Button>
        </span>
      </div>
    </motion.div>
  );
}

// What the person decided, kept in the transcript.
export function DecidedRecommendation({
  input,
  output,
}: {
  input: RecommendActionInput;
  output: RecommendActionOutput;
}) {
  const declined = output.decision === "declined";
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded-full",
          declined ? "bg-muted" : "bg-success/15 text-success",
        )}
      >
        {declined ? (
          <X className="size-3" aria-hidden />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden />
        )}
      </span>
      <span className="min-w-0 truncate">
        {declined ? "Not now" : "Accepted"}: {input.question}
        {output.decision === "alternative" && output.choice && (
          <span className="text-foreground"> — {output.choice}</span>
        )}
      </span>
    </p>
  );
}
