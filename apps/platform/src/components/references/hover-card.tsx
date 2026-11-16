import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  HoverCard as HoverCardRoot,
  HoverCardContent,
  HoverCardTrigger,
} from "@ui-sdk/react/hover-card";
import { popupContainer } from "@lictory/ui/popup";

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

type Place = { side: "bottom" | "top"; align: "start" | "end" };
const BELOW: Place = { side: "bottom", align: "start" };
const PLACES: Place[] = [
  BELOW,
  { side: "bottom", align: "end" },
  { side: "top", align: "start" },
  { side: "top", align: "end" },
];
const GAP = 6;
const EDGE = 8;

// Below, then above; aligned to the reference's start, then its end. The
// first place that fits the window and covers no other reference wins, so
// the next reference in the text stays reachable; when every place covers
// some, the one covering fewest (the first of equals).
function choosePlace(anchorElement: HTMLElement, panel: HTMLElement): Place {
  const anchor = anchorElement.getBoundingClientRect();
  const height = panel.offsetHeight;
  const width = panel.offsetWidth;
  const clampLeft = (left: number) =>
    Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE));
  const others = [...document.querySelectorAll<HTMLElement>("[data-reference]")]
    .filter((el) => el !== anchorElement && !panel.contains(el))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight);
  let best = BELOW;
  let fewest = Infinity;
  for (const place of PLACES) {
    const top =
      place.side === "bottom" ? anchor.bottom + GAP : anchor.top - GAP - height;
    if (top < EDGE || top + height > window.innerHeight - EDGE) continue;
    const left = clampLeft(
      place.align === "start" ? anchor.left : anchor.right - width,
    );
    const covered = others.filter(
      (r) =>
        r.left < left + width &&
        r.right > left &&
        r.top < top + height &&
        r.bottom > top,
    ).length;
    if (covered < fewest) [best, fewest] = [place, covered];
    if (!fewest) break;
  }
  return best;
}

type Card = {
  id: string;
  open: boolean;
  show: () => void;
  hide: () => void;
  // The pointer arrived on the anchor.
  enter: () => void;
  setAnchor: (node: HTMLElement | null) => void;
  panel: HTMLElement | null;
};
const CardContext = createContext<Card | null>(null);

export function HoverCard({
  children,
  content,
  forceOpen = false,
  width = 300,
}: {
  // The reference, as one `HoverCardAnchor`.
  children: ReactNode;
  // Rendered only while open, so closed cards cost nothing.
  content: () => ReactNode;
  // Open regardless of pointer and focus (an editor selection on the node).
  forceOpen?: boolean;
  width?: number;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (shown || forceOpen) && !dismissed;
  const [place, setPlace] = useState(BELOW);

  const show = useCallback(() => {
    setDismissed(false);
    setShown(true);
  }, []);
  const hide = useCallback(() => setShown(false), []);
  // A card closed with Escape stays closed until the pointer comes back.
  const escaped = useRef(false);
  // Moving on from another reference opens this card without the pause. It
  // is still the SDK that opens it, on the pointer's arrival, so it closes
  // again when the pointer leaves; the delay is set before the SDK reads it.
  const [instant, setInstant] = useState(false);
  const enter = useCallback(() => {
    escaped.current = false;
    flushSync(() => setInstant(isWarm()));
  }, []);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Handled: the panel the reference sits in (Litto's dock) stays open.
      event.preventDefault();
      escaped.current = true;
      setDismissed(true);
      setShown(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      closed();
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!anchor || !panel) return;
    const choose = () => setPlace(choosePlace(anchor, panel));
    choose();
    // Content that arrives later (a card's readiness checks) changes the
    // height: choose again.
    const resized = new ResizeObserver(choose);
    resized.observe(panel);
    return () => resized.disconnect();
  }, [anchor, panel]);

  const card = useMemo(
    () => ({ id, open, show, hide, enter, setAnchor, panel }),
    [id, open, show, hide, enter, panel],
  );
  return (
    <CardContext value={card}>
      <HoverCardRoot
        open={open}
        onOpenChange={(next, details) => {
          if (next) {
            // Focus shows the card at once (the anchor's own handler).
            if (details.reason !== "trigger-focus" && !escaped.current) show();
            return;
          }
          setShown(false);
          if (details.reason === "escape-key") {
            escaped.current = true;
            setDismissed(true);
          }
        }}
        delay={instant ? 0 : OPEN_DELAY}
        closeDelay={CLOSE_DELAY}
        container={popupContainer()}
      >
        {children}
        <HoverCardContent
          ref={setPanel}
          data-reference-card
          side={place.side}
          align={place.align}
          sideOffset={GAP}
          collisionPadding={EDGE}
          style={{ width }}
          className="z-50 m-0 block max-h-none max-w-[calc(100vw-16px)] min-w-0 overflow-visible rounded-xl border-0 bg-popover p-0 text-[13px] text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-opacity duration-100 outline-none data-starting-style:opacity-0"
        >
          <div id={id} role="tooltip">
            {content()}
          </div>
        </HoverCardContent>
      </HoverCardRoot>
    </CardContext>
  );
}

// The reference a card belongs to: a link by default, or the element given
// as `render` (a button, or a span inside an editor).
export function HoverCardAnchor({
  press = false,
  ...props
}: Omit<
  ComponentProps<typeof HoverCardTrigger>,
  | "ref"
  | "controller"
  | "payload"
  | "onPointerEnter"
  | "onPointerDown"
  | "onFocus"
  | "onBlur"
  | "onClick"
> & {
  // For anchors that are not links: a click opens the card.
  press?: boolean;
}) {
  const card = use(CardContext);
  // A click focuses the anchor too, and navigates: no card for that. The
  // press ends with the pointer lifting or the browser taking the gesture
  // (a touch that became a scroll never lifts).
  const pressing = useRef(false);
  const release = useRef<AbortController | null>(null);
  useEffect(() => () => release.current?.abort(), []);
  if (!card) throw new Error("HoverCardAnchor needs a HoverCard around it.");
  const { id, open, show, hide, enter, setAnchor, panel } = card;
  return (
    <HoverCardTrigger
      {...props}
      ref={setAnchor}
      aria-describedby={open ? id : undefined}
      onPointerEnter={enter}
      onPointerDown={() => {
        release.current?.abort();
        const press = new AbortController();
        release.current = press;
        pressing.current = true;
        const end = () => {
          pressing.current = false;
          press.abort();
        };
        window.addEventListener("pointerup", end, { signal: press.signal });
        window.addEventListener("pointercancel", end, { signal: press.signal });
      }}
      onFocus={() => {
        if (!pressing.current) show();
      }}
      onBlur={(event) => {
        if (!panel?.contains(event.relatedTarget)) hide();
      }}
      onClick={
        press
          ? (event) => {
              // The press is this card's alone: nothing else to follow.
              event.preventDefault();
              show();
            }
          : undefined
      }
    />
  );
}
