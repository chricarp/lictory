import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  maxWidth,
  paneWidthCss,
  resolveDrag,
  usePaneWidth,
  type DragBounds,
  type PaneId,
} from "@lictory/platform/lib/pane-width";

export type PaneSpec = {
  pane: PaneId;
  // Names the pane in the separator's label: "Resize <label>".
  label: string;
  // The pane edge the handle sits on: "end" for a pane on the left.
  edge: "start" | "end";
  min: number;
  max: number;
  // The most the pane may take of the frame (or the window, for surfaces
  // beside the frame), never less than `floor`, its default width.
  share: { fraction: number; floor: number; of: "frame" | "viewport" };
  // The responsive default at this size: what a drag snaps to.
  preferred: (size: { frame: number; viewport: number }) => number;
  // The surface that gives up room as the pane grows, and the width it keeps.
  neighbour: () => HTMLElement | null;
  keep: number;
};

const STEP = 16;
const LARGE_STEP = 64;

function measure() {
  const frame =
    document.querySelector<HTMLElement>("[data-app-frame]")?.clientWidth ??
    window.innerWidth;
  return { frame, viewport: window.innerWidth };
}

function capCss({ fraction, floor, of }: PaneSpec["share"]) {
  return `max(${fraction * 100}${of === "frame" ? "cqw" : "vw"}, ${floor}px)`;
}

// A pane whose width can be dragged. The pane renders `sized` with
// `w-(--pane-w)` in place of its default width classes; while dragging, the
// width is written straight to that property so the page does not re-render
// on every pointer move, and stored once on release.
export function usePaneResize<T extends HTMLElement = HTMLDivElement>(
  spec: PaneSpec,
  options: {
    // Dragging well past the minimum folds a collapsible pane away.
    collapse?: {
      collapsed: boolean;
      setCollapsed: (collapsed: boolean) => void;
    };
  } = {},
) {
  const { collapse } = options;
  const [width, setWidth] = usePaneWidth(spec.pane);
  const ref = useRef<T | null>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  // A callback ref, so the pane can be attached without exposing the ref.
  const attach = useCallback((element: T | null) => {
    ref.current = element;
  }, []);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const cap = capCss(spec.share);

  const bounds = (current: number): DragBounds => {
    const size = measure();
    const { fraction, floor, of } = spec.share;
    const neighbour = spec.neighbour();
    return {
      min: spec.min,
      max: maxWidth({
        current,
        min: spec.min,
        max: spec.max,
        share: Math.max(floor, fraction * size[of]),
        room: neighbour
          ? neighbour.getBoundingClientRect().width - spec.keep
          : Number.POSITIVE_INFINITY,
      }),
      preferred: spec.preferred(size),
      collapsible: !!collapse,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const pane = ref.current;
    if (event.button !== 0 || !event.isPrimary || !pane) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    const startX = event.clientX;
    const start = pane.getBoundingClientRect().width;
    const startProperty = pane.style.getPropertyValue("--pane-w");
    const startCollapsed = collapse?.collapsed ?? false;
    const limits = bounds(start);
    const direction = spec.edge === "end" ? 1 : -1;
    let result = { width: Math.round(start), collapsed: startCollapsed };
    let lastX = startX;
    let frame = 0;
    // The pane keeps its current width as the drag takes over its sizing.
    pane.style.setProperty("--pane-w", paneWidthCss(start, cap));
    document.documentElement.setAttribute("data-pane-resizing", "");
    setDragging(true);

    const apply = () => {
      frame = 0;
      const next = resolveDrag(start + direction * (lastX - startX), limits);
      if (next.width !== result.width)
        pane.style.setProperty("--pane-w", paneWidthCss(next.width, cap));
      if (next.collapsed !== result.collapsed)
        collapse?.setCollapsed(next.collapsed);
      result = next;
    };
    const controller = new AbortController();
    const finish = (commit: boolean) => {
      controller.abort();
      cancelAnimationFrame(frame);
      stop.current = null;
      document.documentElement.removeAttribute("data-pane-resizing");
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
      const moved = lastX !== startX;
      if (commit && moved && !result.collapsed) setWidth(result.width);
      else {
        // Nothing to store: put back what React rendered.
        if (startProperty) pane.style.setProperty("--pane-w", startProperty);
        else pane.style.removeProperty("--pane-w");
      }
      if (!commit && result.collapsed !== startCollapsed)
        collapse?.setCollapsed(startCollapsed);
      setDragging(false);
    };
    stop.current = () => finish(false);
    const { signal } = controller;
    handle.addEventListener(
      "pointermove",
      (move: globalThis.PointerEvent) => {
        if (move.pointerId !== event.pointerId) return;
        lastX = move.clientX;
        if (!frame) frame = requestAnimationFrame(apply);
      },
      { signal },
    );
    const end = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      if (frame) apply();
      finish(true);
    };
    handle.addEventListener("pointerup", end, { signal });
    handle.addEventListener("pointercancel", end, { signal });
    handle.addEventListener("lostpointercapture", end, { signal });
    // Esc puts the pane back where the drag started, before anything else
    // (such as Litto's own Esc-to-close) sees the key.
    window.addEventListener(
      "keydown",
      (key) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish(false);
      },
      { signal, capture: true },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pane = ref.current;
    if (!pane) return;
    const current = Math.round(pane.getBoundingClientRect().width);
    const limits = bounds(current);
    const step = event.shiftKey ? LARGE_STEP : STEP;
    // Arrows move the divider the way they point.
    const grow = spec.edge === "end" ? "ArrowRight" : "ArrowLeft";
    const shrink = spec.edge === "end" ? "ArrowLeft" : "ArrowRight";
    let next: number;
    if (event.key === grow) next = current + step;
    else if (event.key === shrink) next = current - step;
    else if (event.key === "Home") next = limits.min;
    else if (event.key === "End") next = limits.max;
    else return;
    event.preventDefault();
    setWidth(Math.min(limits.max, Math.max(limits.min, next)));
  };

  const sized = width !== null || dragging;
  return {
    pane: {
      attach,
      id,
      // Apply `w-(--pane-w)` instead of the default width classes.
      sized,
      style:
        width === null
          ? undefined
          : ({ "--pane-w": paneWidthCss(width, cap) } as CSSProperties),
    },
    handle: {
      id,
      label: spec.label,
      min: spec.min,
      max: spec.max,
      dragging,
      onPointerDown,
      onKeyDown,
      // Double-click returns to the responsive default.
      onDoubleClick: () => setWidth(null),
    },
  };
}

// The draggable edge between two surfaces: a hairline that lights up after
// a short hover (so passing the pointer across does not flash it) on a wider
// invisible grip (wider still for touch), operable from the keyboard.
export function PaneResizer({
  resize,
  className,
  inset = false,
}: {
  resize: ReturnType<typeof usePaneResize>["handle"];
  className?: string;
  // Inside a clipped surface's edge rather than straddling a divider.
  inset?: boolean;
}) {
  // The separator reports the width as rendered (a responsive default, a
  // chosen width the window has capped, a drag in progress). It is written
  // to the attribute directly so resizing never re-renders the page.
  const separator = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = document.getElementById(resize.id);
    const handle = separator.current;
    if (!pane || !handle) return;
    const observer = new ResizeObserver(() => {
      const width = Math.round(pane.getBoundingClientRect().width);
      if (width) handle.setAttribute("aria-valuenow", String(width));
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [resize.id]);
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- a focusable, draggable separator is the WAI-ARIA window splitter pattern. */
  return (
    <div
      ref={separator}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${resize.label}`}
      aria-controls={resize.id}
      aria-valuemin={resize.min}
      aria-valuemax={resize.max}
      // Corrected to the rendered width as soon as the pane is measured.
      aria-valuenow={resize.min}
      title="Drag to resize · Double-click to reset"
      tabIndex={0}
      data-pane-resizer
      data-dragging={resize.dragging || undefined}
      onPointerDown={resize.onPointerDown}
      onKeyDown={resize.onKeyDown}
      onDoubleClick={resize.onDoubleClick}
      className={cn(
        // The grip itself: 8px (16px for touch) centred on the divider, with
        // negative margins so it takes no room from either side.
        "group/resizer relative z-20 w-2 shrink-0 cursor-col-resize touch-none outline-none select-none pointer-coarse:w-4",
        !inset && "-mx-1 pointer-coarse:-mx-2",
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 w-0.5 bg-ring opacity-0 transition-opacity duration-150",
          inset ? "left-0" : "left-1/2 -translate-x-1/2",
          "group-hover/resizer:opacity-100 group-hover/resizer:delay-150",
          "group-focus-visible/resizer:opacity-100 group-focus-visible/resizer:delay-0",
          "group-data-dragging/resizer:opacity-100 group-data-dragging/resizer:delay-0",
          "motion-reduce:transition-none",
        )}
      />
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
