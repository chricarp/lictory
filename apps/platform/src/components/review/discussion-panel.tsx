import { useId, useState, type KeyboardEvent } from "react";
import { MessageSquare, X } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";
import { Tooltip } from "@lictory/ui/tooltip";
import { useItem } from "@lictory/platform/components/items/item-context";
import { DiscussionCounts } from "@lictory/platform/components/discussions/presentation";
import {
  ResolvedToggle,
  Thread,
  ThreadComposer,
} from "@lictory/platform/components/review/threads";
import { useSpecDiscussions } from "@lictory/platform/components/review/spec-discussions";

// The specification's discussions beside its text, like a page's comments:
// threads whose passage is on screen in document order, then those whose
// text changed or was removed (each linking to the revision it was written
// on), then discussions of the whole specification. Resolved threads are
// folded away until asked for; resolving never deletes a message.
// Pull request and suggestion threads stay with their change.

const mod =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘⌥M"
    : "Ctrl+Alt+M";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Header toggle: the open discussions of the current revision, with a
// small marker when some block readiness.
export function DiscussionsToggle({ controls }: { controls?: string }) {
  const discussions = useSpecDiscussions();
  if (!discussions) return null;
  const { open, blocking, panelOpen, setPanelOpen } = discussions;
  const tooltip = [
    open ? plural(open, "open discussion") : "No open discussions",
    blocking ? `${blocking} blocking readiness` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Named by what it shows ("3 discussions"), plus what blocks.
  const label = open ? plural(open, "discussion") : "Discussions";
  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        aria-expanded={panelOpen}
        aria-controls={controls}
        aria-label={
          blocking ? `${label}, ${blocking} blocking readiness` : label
        }
        onClick={() => setPanelOpen(!panelOpen)}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 enabled:active:scale-[0.96] touch:h-11 touch:px-3",
          panelOpen
            ? "bg-foreground/8 text-foreground"
            : "bg-card text-foreground/80 shadow-(--shadow-border) hover:bg-muted hover:text-foreground",
        )}
      >
        <MessageSquare className="size-3.5" aria-hidden />
        <span className="tabular-nums max-sm:sr-only">{label}</span>
        {open > 0 && (
          <span aria-hidden className="tabular-nums sm:hidden">
            {open}
          </span>
        )}
        {blocking > 0 && (
          <span
            aria-hidden
            className="-mr-0.5 size-1.5 shrink-0 rounded-full bg-destructive/80 ring-2 ring-destructive/12"
          />
        )}
      </button>
    </Tooltip>
  );
}

// Plain work keeps its discussions under the description; the header
// says how many are open and goes there.
export function CommentsJump() {
  const { threads, reviewable } = useItem();
  if (reviewable) return null;
  const open = threads.filter((t) => t.status === "open").length;
  const label = open ? plural(open, "open discussion") : "Discussions";
  return (
    <button
      type="button"
      aria-label={`Go to discussions${open ? ` (${label})` : ""}`}
      title="Go to discussions"
      onClick={() => {
        const section = document.getElementById("item-comments");
        section?.scrollIntoView({ block: "start", behavior: "smooth" });
        section
          ?.querySelector<HTMLElement>(
            "[data-thread-id], textarea, [contenteditable=true]",
          )
          ?.focus({ preventScroll: true });
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 text-xs font-medium text-foreground/80 shadow-(--shadow-border) transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:h-11 touch:px-3"
    >
      <MessageSquare className="size-3.5" aria-hidden />
      <span className="tabular-nums max-sm:sr-only">
        {open ? plural(open, "discussion") : "Discussions"}
      </span>
      {open > 0 && (
        <span aria-hidden className="tabular-nums sm:hidden">
          {open}
        </span>
      )}
    </button>
  );
}

// Alt+Arrow keys move between threads (Home and End with Alt to the first
// and last); the thread reached is selected, so its passage is marked.
function moveBetweenThreads(
  event: KeyboardEvent<HTMLElement>,
  select: (id: string) => void,
) {
  if (!event.altKey) return;
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const cards = [
    ...event.currentTarget.querySelectorAll<HTMLElement>("[data-thread-id]"),
  ];
  if (!cards.length) return;
  const at = cards.findIndex((card) => card.contains(document.activeElement));
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? cards.length - 1
        : event.key === "ArrowDown"
          ? Math.min(cards.length - 1, at + 1)
          : Math.max(0, at === -1 ? 0 : at - 1);
  event.preventDefault();
  const card = cards[next]!;
  card.focus();
  const id = card.getAttribute("data-thread-id");
  if (id) select(id);
}

export function SpecDiscussionPanel({
  onClose,
  onLeave,
}: {
  onClose: () => void;
  // The panel is a sheet and something opens in the document (a decision
  // composer): the sheet steps aside.
  onLeave?: () => void;
}) {
  const discussions = useSpecDiscussions();
  const { readOnly } = useItem();
  const headingId = useId();
  const [showResolved, setShowResolved] = useState(false);
  if (!discussions) return null;
  const {
    located,
    open,
    blocking,
    active,
    setActive,
    hovered,
    setHovered,
    pending,
    setPending,
    showRevision,
  } = discussions;
  const openThreads = located.filter((l) => l.thread.status === "open");
  const anchored = openThreads.filter((l) => l.placement !== "general");
  const general = openThreads.filter((l) => l.placement === "general");
  const resolved = located.filter((l) => l.thread.status === "resolved");
  // Selecting a thread marks its passage and brings it into view. In the
  // sheet the passage is under it: the sheet steps aside first (the marked
  // passage opens the discussion again).
  const showInText = (id: string) => {
    setActive(id);
    // The passage takes focus too, so keyboard and screen reader users
    // land on it (the toggle or the marked passage opens the discussion
    // again).
    const reveal = () => {
      const mark = document.querySelector<HTMLElement>(
        `[data-spec-root] mark[data-threads~="${CSS.escape(id)}"]`,
      );
      if (!mark) return;
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      if (!mark.hasAttribute("tabindex")) mark.tabIndex = -1;
      mark.focus({ preventScroll: true });
    };
    if (onLeave) {
      onLeave();
      // After the sheet has closed and handed focus back to its opener.
      window.setTimeout(reveal, 0);
    } else reveal();
  };
  // The blocking count goes to the next blocking discussion, in order.
  const nextBlocking = () => {
    const ids = openThreads
      .filter((l) => l.thread.blocking)
      .map((l) => l.thread.id);
    if (!ids.length) return;
    const next = ids[(ids.indexOf(active ?? "") + 1) % ids.length]!;
    setActive(next);
    const card = document.querySelector<HTMLElement>(
      `[data-discussions] [data-thread-id="${CSS.escape(next)}"]`,
    );
    card?.scrollIntoView({ block: "start", behavior: "smooth" });
    card?.focus({ preventScroll: true });
  };
  const card = (view: (typeof located)[number]) => (
    <Thread
      key={view.thread.id}
      thread={view.thread}
      placement={view.placement}
      active={view.thread.id === active}
      hovered={view.thread.id === hovered}
      onHover={setHovered}
      onShowInText={showInText}
      onShowRevision={showRevision}
      onBeforeDecision={onLeave}
    />
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* Stays in view while the threads scroll beneath it. */}
      <div className="sticky top-0 z-10 -mx-4 flex h-11 shrink-0 items-center gap-2 border-b bg-background px-4">
        <h2
          id={headingId}
          tabIndex={-1}
          className="shrink-0 text-sm font-semibold outline-none"
        >
          Discussions
        </h2>
        <DiscussionCounts
          open={open}
          blocking={blocking}
          onBlocking={nextBlocking}
        />
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1.5 ml-auto"
          aria-label="Close discussions"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      {blocking > 0 && (
        <p className="-mt-1 text-xs leading-5 text-muted-foreground">
          Blocking discussions hold readiness back until they are resolved.
        </p>
      )}
      {/* One composer, on top: a comment on selected text fills it with
        the passage; otherwise it starts a discussion of the whole text. */}
      {!readOnly && (
        <ThreadComposer
          draft={pending}
          onDraftChange={setPending}
          onCreated={setActive}
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Alt+Arrow keys bubble from the thread cards and their controls. */}
      <div
        className="flex flex-col gap-3"
        onKeyDown={(event) => moveBetweenThreads(event, setActive)}
      >
        {open === 0 && !pending && (
          <p className="text-[13px] text-muted-foreground">
            {readOnly
              ? "No open discussions."
              : "No open discussions. Select text in the specification to comment on it, or start a discussion of the whole text above."}
          </p>
        )}
        {anchored.map(card)}
        {general.length > 0 && (
          <SectionLabel className="mt-2">
            On the whole specification
          </SectionLabel>
        )}
        {general.map(card)}
        {resolved.length > 0 && (
          <ResolvedToggle
            count={resolved.length}
            shown={showResolved}
            onToggle={() => setShowResolved((v) => !v)}
            className="-ml-2 self-start"
          />
        )}
        {showResolved && resolved.map(card)}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground touch:hidden">
        Alt+↑ / Alt+↓ move between discussions · {mod} comments on selected text
      </p>
    </section>
  );
}
