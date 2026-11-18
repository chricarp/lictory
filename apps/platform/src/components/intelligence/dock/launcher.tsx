import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { Toggle } from "@ui-sdk/react/toggle";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  reviewState,
  useDock,
  useDockState,
} from "@lictory/platform/components/intelligence/dock/store";

const noSubscribe = () => () => undefined;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function useLitto() {
  const store = useDock();
  const state = useDockState();
  const { directory } = useWorkspace();
  const available = !!store && directory.ai.available && directory.ai.enabled;
  return { store, state, available };
}

const pill =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.97]";

// Opens and closes Litto's side sheet from a page header. It lives in the
// header's trailing actions on every page that has one, so the assistant is
// always in the same place and never floats over the work.
// Phones and tablets reach it from the app's top bar instead (`compact`).
export function LittoLauncher({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { store, state, available } = useLitto();
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (isMac() ? "⌘J" : "Ctrl J"),
    () => "Ctrl J",
  );
  if (!available) return null;
  const open = state.expanded;
  const review = state.item?.review
    ? reviewState(state.item.review)
    : undefined;
  const reviewing = !!review?.active;
  // Phones have no room for the concerns pill: the top-bar button carries
  // the count of the current assessment instead.
  const concerns =
    compact && review?.completed && !review.completed.staleAt
      ? review.completed.findings.length
      : 0;
  const label = open
    ? "Close Litto assistant"
    : concerns
      ? `Ask Litto, the assistant. ${concerns} AI ${concerns === 1 ? "concern" : "concerns"} on this item`
      : "Ask Litto, the assistant";
  return (
    <Toggle
      pressed={open}
      onPressedChange={() => store!.open({ toggle: true })}
      // Keeps the page's text selection, which travels with the question.
      onMouseDown={(e) => e.preventDefault()}
      aria-keyshortcuts="Meta+J Control+J"
      aria-label={label}
      title={`${open ? "Close" : "Open"} Litto  ${shortcut}`}
      data-litto-launcher
      className={cn(
        pill,
        "group/launcher bg-card text-foreground shadow-(--shadow-border) hover:bg-muted data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:shadow-none data-pressed:hover:bg-primary",
        compact
          ? "relative size-9 justify-center"
          : "pr-1.5 pl-2.5 max-lg:hidden",
        className,
      )}
    >
      <IntelligenceMark
        mood={reviewing ? "working" : undefined}
        className="size-4 shrink-0 text-foreground group-data-pressed/launcher:text-primary-foreground"
      />
      <span className={cn(compact && "sr-only")}>Ask Litto</span>
      <kbd
        aria-hidden
        className={cn(
          "h-5 items-center rounded-full bg-muted px-1.5 font-mono text-[10.5px] font-medium tracking-[0.04em] text-muted-foreground group-data-pressed/launcher:bg-primary-foreground/15 group-data-pressed/launcher:text-primary-foreground/80",
          compact ? "hidden" : "inline-flex",
        )}
      >
        {shortcut}
      </kbd>
      {concerns > 0 && !open && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 font-mono text-[10px] font-medium text-background ring-2 ring-background"
        >
          {concerns}
        </span>
      )}
    </Toggle>
  );
}

// The open item's AI assessment at a glance, beside the launcher: how many
// concerns Litto proposed for the current revision. It opens the findings in
// the sheet. A stale assessment says so instead of showing a current count.
export function LittoConcerns({ className }: { className?: string }) {
  const { store, state, available } = useLitto();
  const review = state.item?.review;
  // While the sheet is open it shows the assessment itself.
  if (!available || !review || state.expanded) return null;
  const { completed, active } = reviewState(review);
  if (!completed && !active) return null;
  const show = () => store!.open({ showReview: true });
  const base = cn(
    pill,
    // Phones read the assessment in the sheet; a bare dot would be a riddle.
    "h-7 gap-1.5 px-2.5 text-[12px] text-muted-foreground ring-1 ring-border ring-inset hover:bg-muted hover:text-foreground max-sm:hidden",
    className,
  );
  if (active)
    return (
      <button type="button" onClick={show} className={base} aria-live="polite">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
        <span>Assessing…</span>
      </button>
    );
  const findings = completed!.findings;
  const stale = !!completed!.staleAt;
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const label = findings.length
    ? `${findings.length} AI ${findings.length === 1 ? "concern" : "concerns"}`
    : "No AI concerns";
  return (
    <button
      type="button"
      onClick={show}
      title={
        stale
          ? "Litto assessed an earlier revision. Open it to assess this one."
          : "Concerns Litto proposed for this revision. People decide."
      }
      className={base}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          stale
            ? "bg-muted-foreground/50"
            : blockers
              ? "bg-destructive"
              : findings.length
                ? "bg-warning"
                : "bg-success",
        )}
      />
      <span>
        {label}
        {stale && " · earlier revision"}
      </span>
    </button>
  );
}
