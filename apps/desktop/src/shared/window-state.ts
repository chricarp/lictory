// Where the window reopens. A saved position is used only while it is still
// visible on a connected display; otherwise the window is centred on the
// primary display (a monitor was unplugged, the resolution changed).

export type Rect = { x: number; y: number; width: number; height: number };
export type WindowState = Rect & { maximized: boolean; fullScreen: boolean };

export const MIN_WIDTH = 720;
export const MIN_HEIGHT = 480;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;
// How much of the title area must stay on a display to count as visible.
const VISIBLE = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function normalizeWindowState(raw: unknown): WindowState | null {
  if (!isRecord(raw)) return null;
  const { x, y, width, height } = raw;
  if (!isInt(x) || !isInt(y) || !isInt(width) || !isInt(height)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(MIN_WIDTH, Math.round(width)),
    height: Math.max(MIN_HEIGHT, Math.round(height)),
    maximized: raw.maximized === true,
    fullScreen: raw.fullScreen === true,
  };
}

function overlaps(a: Rect, b: Rect) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width >= VISIBLE && height >= Math.min(VISIBLE, a.height);
}

export function restoreBounds(
  saved: WindowState | null,
  workAreas: readonly Rect[],
): WindowState {
  const primary = workAreas[0] ?? {
    x: 0,
    y: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  const fit = (width: number, height: number, area: Rect) => ({
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
  });
  if (saved) {
    // The title area (top strip) must be on some display.
    const title: Rect = {
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: VISIBLE,
    };
    const area = workAreas.find((a) => overlaps(title, a));
    if (area)
      return {
        ...saved,
        ...fit(saved.width, saved.height, area),
      };
  }
  const size = fit(
    saved?.width ?? DEFAULT_WIDTH,
    saved?.height ?? DEFAULT_HEIGHT,
    primary,
  );
  return {
    x: Math.round(primary.x + (primary.width - size.width) / 2),
    y: Math.round(primary.y + (primary.height - size.height) / 2),
    ...size,
    maximized: saved?.maximized ?? false,
    fullScreen: false,
  };
}
