import { useCallback, useSyncExternalStore } from "react";

// Pane widths a person dragged, kept in this browser (like collapsed panels).
// They describe a screen, not an organization, so every workspace shares them.
export type PaneId = "work-item-list" | "review-rail" | "litto";

// Within this distance of the default width a drag settles on the default.
const SNAP_DISTANCE = 8;
// Dragging a collapsible pane this far past its minimum folds it away.
export const COLLAPSE_DISTANCE = 64;

const listeners = new Set<() => void>();
const fallback = new Map<PaneId, number | null>();
const key = (pane: PaneId) => `lictory:pane-width:${pane}`;

function parse(value: string | null) {
  if (value === null) return null;
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

function read(pane: PaneId) {
  if (fallback.has(pane)) return fallback.get(pane)!;
  try {
    return parse(window.localStorage.getItem(key(pane)));
  } catch {
    return null;
  }
}

function write(pane: PaneId, width: number | null) {
  try {
    if (width === null) window.localStorage.removeItem(key(pane));
    else window.localStorage.setItem(key(pane), String(width));
    fallback.delete(pane);
  } catch {
    // Resizing still works for this page when browser storage is unavailable.
    fallback.set(pane, width);
  }
  listeners.forEach((listener) => listener());
}

// The stored width, or null for the pane's own responsive default.
export function usePaneWidth(pane: PaneId) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key(pane) || event.key === null) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [pane],
  );
  const width = useSyncExternalStore(
    subscribe,
    () => read(pane),
    () => null,
  );
  const setWidth = useCallback(
    (next: number | null) => write(pane, next),
    [pane],
  );
  return [width, setWidth] as const;
}

// A chosen width never takes more than the pane's share of the space (`cap`,
// a CSS length such as `30cqw`), but the share never drops below the default:
// a wider pane gives its extra room back when the window narrows, a narrower
// one stays as chosen.
export function paneWidthCss(width: number, cap: string) {
  return `min(${Math.round(width)}px, ${cap})`;
}

export type DragBounds = {
  min: number;
  max: number;
  // The default width at the current frame size: the snap target.
  preferred: number;
  collapsible: boolean;
};

// Where a drag that asks for `requested` pixels lands.
export function resolveDrag(requested: number, bounds: DragBounds) {
  if (bounds.collapsible && requested < bounds.min - COLLAPSE_DISTANCE)
    return { width: bounds.min, collapsed: true };
  const snapped =
    Math.abs(requested - bounds.preferred) <= SNAP_DISTANCE
      ? bounds.preferred
      : requested;
  return {
    width: Math.round(Math.min(bounds.max, Math.max(bounds.min, snapped))),
    collapsed: false,
  };
}

// The largest width a pane may take right now: its own maximum, its share of
// the space, and what keeps the neighbouring surface readable (`room` is how
// much the neighbour can give before reaching its own minimum).
export function maxWidth({
  current,
  min,
  max,
  share,
  room,
}: {
  current: number;
  min: number;
  max: number;
  share: number;
  room: number;
}) {
  return Math.round(
    Math.max(min, Math.min(max, share, current + Math.max(0, room))),
  );
}
