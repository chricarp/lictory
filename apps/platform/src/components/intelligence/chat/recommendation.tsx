import { Check, ChevronDown, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@lictory/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@lictory/ui/ai/item";
import { TraceIcon, TraceLine, TraceTitle } from "@lictory/ui/ai/trace";
import type {
  RecommendActionInput,
  RecommendActionOutput,
} from "@lictory/core/intelligence/chat/shared";
import { cn } from "@lictory/core/lib/utils";

// A change Litto proposes on its own initiative. Nothing happens until the
// person accepts it or picks an alternative.

type Confidence = RecommendActionInput["confidence"];
const confidence: Record<
  Confidence,
  { bars: number; tone: string; label: string }
> = {
  high: { bars: 3, tone: "bg-foreground/70", label: "Litto is fairly sure" },
  medium: { bars: 2, tone: "bg-foreground/50", label: "Litto is unsure" },
  low: { bars: 1, tone: "bg-foreground/35", label: "Litto is guessing" },
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
  onDecide: (output: RecommendActionOutput) => Promise<void>;
}) {
  // -1 is the recommendation itself; otherwise an alternative's index.
  const [selected, setSelected] = useState(-1);
  const [open, setOpen] = useState(false);
  const [decided, setDecided] = useState(false);
  const alternatives = input.alternatives;
  const chosen = selected >= 0 ? alternatives[selected] : undefined;
  const level = chosen?.confidence ?? input.confidence;
  const decide = (output: RecommendActionOutput) => {
    setDecided(true);
    // Still on screen once sent: it was not applied and can be answered again.
    void onDecide(output).then(() => setDecided(false));
  };
  const options = [
    { label: input.action, confidence: input.confidence, i: -1 },
    ...alternatives.map((a, i) => ({ ...a, i })),
  ];
  return (
    <Item
      data-litto-waiting
      tabIndex={-1}
      variant="attention"
      role="group"
      aria-label="Recommendation"
      className="activity-enter items-start"
    >
      <ItemMedia
        variant="icon"
        className="bg-warning/12 text-warning"
        aria-hidden
      >
        <Lightbulb />
      </ItemMedia>
      <ItemContent className="gap-1">
        <ItemTitle className="flex-wrap">{input.question}</ItemTitle>
        <p
          key={selected}
          className="activity-enter text-[13px] leading-5 text-foreground/85"
        >
          {chosen ? chosen.label : input.action}
        </p>
        {!chosen && <ItemDescription>{input.reason}</ItemDescription>}
      </ItemContent>
      {alternatives.length > 0 && open && (
        <fieldset className="activity-enter -mx-1 grid min-w-0 basis-full gap-0.5">
          <legend className="sr-only">Options</legend>
          {options.map((o) => (
            <label
              key={o.i}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-100 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                o.i === selected && "bg-muted",
              )}
            >
              <input
                type="radio"
                name={`${input.question}-option`}
                checked={o.i === selected}
                // Arrow keys move through the options: the list stays open
                // until the person accepts or closes it.
                onChange={() => setSelected(o.i)}
                className="sr-only"
              />
              <span className="mt-1">
                <Meter level={o.confidence} />
              </span>
              <span className="min-w-0 flex-1 text-[12.5px] leading-5 break-words">
                {o.i === -1 && (
                  <span className="font-medium">Recommended: </span>
                )}
                {o.label}
                <span className="block text-[11.5px] text-muted-foreground">
                  {confidence[o.confidence].label}
                </span>
              </span>
              {o.i === selected && (
                <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              )}
            </label>
          ))}
        </fieldset>
      )}
      <ItemFooter className="flex-wrap">
        <span
          className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground"
          title="Litto's own estimate from what it read. It is not a check: nothing has run yet."
        >
          <Meter level={level} />
          {confidence[level].label}
          <span className="font-normal">· an estimate, nothing has run</span>
        </span>
        <ItemActions className="ml-auto">
          {alternatives.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              disabled={decided}
              onClick={() => setOpen((o) => !o)}
              className="touch:h-11 touch:px-4"
            >
              Alternatives
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={decided}
            onClick={() => decide({ decision: "declined", choice: null })}
            className="touch:h-11 touch:px-4"
          >
            Not now
          </Button>
          <Button
            size="sm"
            disabled={decided}
            className="touch:h-11 touch:px-4"
            onClick={() =>
              decide(
                chosen
                  ? { decision: "alternative", choice: chosen.label }
                  : { decision: "accepted", choice: null },
              )
            }
          >
            {chosen ? "Use this" : "Accept"}
          </Button>
        </ItemActions>
      </ItemFooter>
    </Item>
  );
}

// What the person decided, kept in the transcript as a line.
export function DecidedRecommendation({
  input,
  output,
}: {
  input: RecommendActionInput;
  output: RecommendActionOutput;
}) {
  const declined = output.decision === "declined";
  return (
    <TraceLine className="max-w-full">
      <TraceIcon className={declined ? undefined : "text-success"}>
        {declined ? <X /> : <Check strokeWidth={3} />}
      </TraceIcon>
      <TraceTitle>
        {declined ? "Not now" : "You accepted"}: {input.question}
        {output.decision === "alternative" && output.choice && (
          <span className="text-foreground"> — {output.choice}</span>
        )}
      </TraceTitle>
    </TraceLine>
  );
}
