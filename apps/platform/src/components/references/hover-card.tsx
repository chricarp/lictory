import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
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

// One pending open or close per card, and whether a pointer is pressing
// the anchor (a click focuses it too, and navigates: no card for that).
class Delay {
  private id: number | undefined;
  private pressing = false;
  // Pressed until the pointer is released anywhere.
  press() {
    this.pressing = true;
    window.addEventListener(
      "pointerup",
      () => {
        this.pressing = false;
      },
      { once: true },
    );
  }
  get pressed() {
    return this.pressing;
  }
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
  onFocus: () => void;
  onBlur: () => void;
  onPointerDown: () => void;
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
      // Escape closes the topmost layer only: the panel or dialog the
      // reference sits in (Litto's dock) stays open.
      event.preventDefault();
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
      const clampLeft = (left: number) =>
        Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
      // Below, then above; aligned to the reference's start, then its end.
      // The first place that fits the window and covers no other reference
      // wins, so the next reference in the text stays reachable.
      const candidates = [anchor.bottom + gap, anchor.top - gap - height]
        .filter((top) => top >= 8 && top + height <= window.innerHeight - 8)
        .flatMap((top) => [
          { top, left: clampLeft(anchor.left) },
          { top, left: clampLeft(anchor.right - panelWidth) },
        ]);
      const others = [
        ...document.querySelectorAll<HTMLElement>("[data-reference]"),
      ]
        .filter((el) => el !== anchorElement && !panel.contains(el))
        .map((el) => el.getBoundingClientRect())
        .filter(
          (r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight,
        );
      const covered = (c: { top: number; left: number }) =>
        others.filter(
          (r) =>
            r.left < c.left + panelWidth &&
            r.right > c.left &&
            r.top < c.top + height &&
            r.bottom > c.top,
        ).length;
      // When every place covers some, the one covering fewest (the first
      // of equals).
      let best = candidates[0];
      let fewest = best ? covered(best) : 0;
      for (const c of candidates.slice(1)) {
        if (!fewest) break;
        const n = covered(c);
        if (n < fewest) [best, fewest] = [c, n];
      }
      setPosition(
        best ?? { top: anchor.bottom + gap, left: clampLeft(anchor.left) },
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    // Content that arrives later (a card's readiness checks) changes the
    // height: place it again.
    const resized = new ResizeObserver(place);
    if (panelRef.current) resized.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      resized.disconnect();
    };
  }, [open, anchorElement]);

  const anchor: HoverCardAnchor = {
    ref: setAnchorElement,
    onPointerEnter: () => show(OPEN_DELAY),
    onPointerLeave: () => hide(),
    onFocus: () => {
      if (!delay.pressed) show(0);
    },
    onPointerDown: () => delay.press(),
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
