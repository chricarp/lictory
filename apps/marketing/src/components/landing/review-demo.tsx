"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, CheckCircle2, Pause, Play } from "lucide-react";
import { RevisionDiff } from "@lictory/ui/diff";
import { Avatar } from "@lictory/ui/primitives";
import { cn } from "@lictory/core/lib/utils";

const steps = ["Review", "Revise", "Ready"] as const;
/** How long each stage stays on screen while the example plays itself. */
const stepDurationMs = [4500, 4500, 4000] as const;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeToMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** An illustrative walkthrough; it never changes a workspace or grants approvals. */
export function ReviewDemo() {
  const [step, setStep] = useState(0);
  // Server renders and reduced-motion visitors get a static example.
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => true,
  );
  const [stopped, setStopped] = useState(false);
  const playing = !reducedMotion && !stopped;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? true),
      { threshold: 0.3 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The timer only runs while the example is visible and not being inspected.
  const running = playing && onScreen && !hovered && !focused;
  const advance = () => setStep((current) => (current + 1) % steps.length);
  const revised = step > 0;
  const ready = step === 2;

  return (
    <div
      ref={rootRef}
      aria-label="Interactive specification example"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      className="review-demo app-preview dark overflow-hidden rounded-lg border border-border bg-background text-left"
      data-theme="lictory"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          {reducedMotion ? null : (
            <button
              type="button"
              onClick={() => setStopped((value) => !value)}
              aria-label={playing ? "Pause example" : "Play example"}
              className="-ml-2 grid size-11 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {playing ? (
                <Pause aria-hidden className="size-3.5" />
              ) : (
                <Play aria-hidden className="size-3.5" />
              )}
            </button>
          )}
          <span
            className={cn(
              "text-xs text-muted-foreground",
              !reducedMotion && "hidden sm:inline",
            )}
          >
            Example workflow
          </span>
        </div>
        <div role="group" aria-label="Example stages" className="flex gap-1">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={step === index}
              aria-controls={panelId}
              onClick={() => {
                // Choosing a stage hands control to the visitor.
                setStopped(true);
                setStep(index);
              }}
              className={cn(
                "relative min-h-11 overflow-hidden rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3",
                step === index
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
              {playing && step === index ? (
                <span
                  key={step}
                  aria-hidden
                  onAnimationEnd={advance}
                  style={{
                    animationDuration: `${stepDurationMs[index]}ms`,
                    animationPlayState: running ? "running" : "paused",
                  }}
                  className="absolute inset-x-2 bottom-1.5 h-0.5 origin-left rounded-full bg-primary [animation-fill-mode:both] [animation-name:demo-progress] [animation-timing-function:linear]"
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div
        id={panelId}
        role="region"
        aria-label={`${steps[step]} example`}
        aria-live={playing ? "off" : "polite"}
        aria-atomic="true"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 text-xs sm:px-6">
          <span className="font-medium text-foreground/90">
            Retry failed payments
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            Revision {revised ? "13" : "12"}
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:gap-6 sm:p-6">
          <div className="min-h-15 text-sm leading-6 sm:min-h-30 sm:text-base sm:leading-7">
            <p className="mb-2 hidden text-xs font-medium text-muted-foreground sm:block">
              Specification
            </p>
            {revised ? (
              <RevisionDiff
                before="Retry failed payments as needed."
                after={
                  "Retry failed payments up to 3 times.\nReuse the transaction ID."
                }
              />
            ) : (
              <p key="original" className="demo-step-in">
                Retry failed payments{" "}
                <mark className="rounded bg-destructive/15 px-1 text-foreground underline decoration-destructive/60 decoration-dotted underline-offset-4">
                  as needed
                </mark>
                .
              </p>
            )}
          </div>
          <div
            className={cn(
              "min-h-24 rounded-lg p-3 text-xs leading-5 transition-colors duration-300",
              "border border-border bg-card",
            )}
          >
            {ready ? (
              <div key="ready" className="demo-step-in">
                <p className="flex items-center gap-2 font-medium text-emerald-300">
                  <CheckCircle2 aria-hidden className="size-3.5" />3 of 3
                  approvals · revision 13
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-foreground/80">
                  {["Product", "Engineering", "QA"].map((role) => (
                    <span key={role} className="flex items-center gap-1">
                      <Check aria-hidden className="size-3" />
                      {role}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-muted-foreground">
                  Acceptance criteria checked. No blockers.
                </p>
              </div>
            ) : (
              <div
                key={revised ? "resolved" : "blocking"}
                className="demo-step-in"
              >
                <p className="flex items-center gap-2 font-medium">
                  <Avatar name="Marta" size="xs" />
                  Marta · Engineering
                  <span
                    className={cn(
                      "ml-auto text-xs",
                      revised ? "text-emerald-300" : "text-amber-300",
                    )}
                  >
                    {revised ? "Resolved" : "Blocking"}
                  </span>
                </p>
                <p className="mt-2 text-foreground/80">
                  {revised
                    ? "The author defined the limit and idempotency. Marta resolved the thread."
                    : "How many retries? Could we charge twice?"}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs sm:px-6">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full transition-colors duration-300",
              ready ? "bg-emerald-400" : "bg-amber-300",
            )}
          />
          <span
            key={step}
            className={cn(
              "demo-step-in",
              ready ? "text-emerald-300" : "text-muted-foreground",
            )}
          >
            {ready
              ? "Agreed specification. Ready to decompose."
              : revised
                ? "New revision. Reviewers approve this version."
                : "One ambiguity caught before implementation."}
          </span>
        </div>
      </div>
    </div>
  );
}
