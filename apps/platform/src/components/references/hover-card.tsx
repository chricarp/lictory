import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@lictory/core/lib/utils";

// More about a reference, for whoever points at it or focuses it: shown
// after a short pause on hover, at once on keyboard focus (or while an
// editor's selection rests on the reference), kept open while the pointer
// is over it, closed by Escape, leaving or blurring (WCAG 1.4.13). The card
// describes its anchor (`aria-describedby`), so screen readers hear it with
// the reference; the anchor itself stays the keyboard path to the target,
// which is why the card's own link is for pointers only.

const OPEN_DELAY = 400;
const CLOSE_DELAY = 120;
// Moving from one reference to the next swaps the card at once.
const WARM_FOR = 400;
const warmth = { open: 0, closedAt: 0 };
const isWarm = () => warmth.open > 0 || Date.now() - warmth.closedAt < WARM_FOR;
function opened() {
  warmth.open += 1;
}
function closed() {
  warmth.open -= 1;
  warmth.closedAt = Date.now();
}

// One pending open or close per card.
class Delay {
  private id: number | undefined;
  run(action: () => void, ms: number) {
    this.cancel();
    this.id = window.setTimeout(action, ms);
  }
  cancel() {
    window.clearTimeout(this.id);
  }
}

export type HoverCardAnchor = {
  ref: (node: HTMLElement | null) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: (event: FocusEvent) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  // For anchors that are not links: a click opens the card.
  onClick: () => void;
  "aria-describedby": string | undefined;
};

export function HoverCard({
  children,
  content,
  forceOpen = false,
  width = 300,
}: {
  children: (anchor: HoverCardAnchor) => ReactNode;
  // Rendered only while open, so closed cards cost nothing.
  content: () => ReactNode;
  // Open regardless of pointer and focus (an editor selection on the node).
  forceOpen?: boolean;
  width?: number;
}) {
  const id = useId();
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [delay] = useState(() => new Delay());
  const [hovered, setHovered] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || forceOpen) && !dismissed;
  const [position, setPosition] = useState<{ top: number; left: number }>();

  const clear = () => delay.cancel();
  const show = useCallback(
    (ms: number) => {
      const run = () => {
        setDismissed(false);
        setHovered(true);
      };
      if (isWarm() || ms === 0) {
        delay.cancel();
        run();
      } else delay.run(run, ms);
    },
    [delay],
  );
  const hide = useCallback(
    (ms = CLOSE_DELAY) => delay.run(() => setHovered(false), ms),
    [delay],
  );
  useEffect(() => () => delay.cancel(), [delay]);
  // Escape dismisses a card the editor's selection holds open until the
  // selection moves off the reference.
  const [heldOpen, setHeldOpen] = useState(forceOpen);
  if (heldOpen !== forceOpen) {
    setHeldOpen(forceOpen);
    if (!forceOpen) setDismissed(false);
  }

  useEffect(() => {
    if (!open) return;
    opened();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDismissed(true);
      setHovered(false);
    };
    const end = () => setHovered(false);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", end);
    return () => {
      closed();
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", end);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorElement?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const gap = 6;
      const height = panel.offsetHeight;
      const panelWidth = panel.offsetWidth;
      let top = anchor.bottom + gap;
      if (
        top + height > window.innerHeight - 8 &&
        anchor.top - gap - height > 8
      )
        top = anchor.top - gap - height;
      const left = Math.min(
        Math.max(8, anchor.left),
        window.innerWidth - panelWidth - 8,
      );
      setPosition({ top, left: Math.max(8, left) });
    };
    place();
    window.addEventListener("scroll", place, true);
    return () => window.removeEventListener("scroll", place, true);
  }, [open, anchorElement]);

  const anchor: HoverCardAnchor = {
    ref: setAnchorElement,
    onPointerEnter: () => show(OPEN_DELAY),
    onPointerLeave: () => hide(),
    onFocus: (event) => {
      // Keyboard focus only: a click focuses too, and navigates.
      if ((event.target as HTMLElement).matches(":focus-visible")) show(0);
    },
    onBlur: () => hide(0),
    onKeyDown: (event) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setDismissed(true);
        setHovered(false);
      }
    },
    onClick: () => show(0),
    "aria-describedby": open ? id : undefined,
  };

  return (
    <>
      {children(anchor)}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            data-reference-card
            onPointerEnter={clear}
            onPointerLeave={() => hide()}
            style={{
              width,
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
            }}
            className={cn(
              "fixed z-50 max-w-[calc(100vw-16px)] rounded-xl bg-popover text-[13px] text-popover-foreground shadow-lg ring-1 ring-foreground/10",
              position ? "animate-in" : "invisible",
            )}
          >
            {content()}
          </div>,
          document.body,
        )}
    </>
  );
}
