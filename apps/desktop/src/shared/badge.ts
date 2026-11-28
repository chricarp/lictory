// The unread badge. Each server's page reports its own count (unread
// notifications that ask for the person's attention, later also mentions and
// direct messages); the dock, taskbar and tray show the sum.

export function sanitizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return 0;
  return Math.min(Math.floor(value), 9999);
}

export function totalCount(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return Math.min(total, 9999);
}

// The text a badge shows: nothing for zero, at most "99+".
export function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function unreadSummary(count: number): string {
  if (count <= 0) return "No unread notifications";
  return count === 1
    ? "1 unread notification"
    : `${badgeLabel(count)} unread notifications`;
}

// Windows has no numeric taskbar badge: an overlay icon carries it. It is
// drawn here (a red disc with white digits, "9+" above nine) as raw
// premultiplied BGRA pixels for nativeImage.createFromBitmap.

const font: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
};

type Rgb = readonly [number, number, number];
const RED: Rgb = [0xe5, 0x48, 0x4d];
const WHITE: Rgb = [0xff, 0xff, 0xff];

function blend(pixels: Uint8Array, index: number, color: Rgb, alpha: number) {
  // Source-over on premultiplied BGRA.
  const a = Math.max(0, Math.min(1, alpha));
  if (a === 0) return;
  const inv = 1 - a;
  pixels[index] = Math.round(color[2] * a + (pixels[index] ?? 0) * inv);
  pixels[index + 1] = Math.round(color[1] * a + (pixels[index + 1] ?? 0) * inv);
  pixels[index + 2] = Math.round(color[0] * a + (pixels[index + 2] ?? 0) * inv);
  pixels[index + 3] = Math.round(255 * a + (pixels[index + 3] ?? 0) * inv);
}

// Coverage of a disc, sampled 4×4 per pixel for smooth edges.
function drawDisc(
  pixels: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
) {
  const height = pixels.length / 4 / width;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + 0.5) / 4 - cx;
          const dy = y + (sy + 0.5) / 4 - cy;
          if (dx * dx + dy * dy <= radius * radius) inside++;
        }
      if (inside) blend(pixels, (y * width + x) * 4, color, inside / 16);
    }
}

export function renderBadge(count: number, size = 32): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  if (count <= 0) return pixels;
  drawDisc(pixels, size, size / 2, size / 2, size / 2, RED);
  const text = count > 9 ? "9+" : String(count);
  const scale = Math.max(1, Math.floor(size / 16));
  const glyphWidth = 5 * scale;
  const gap = scale;
  const textWidth = text.length * glyphWidth + (text.length - 1) * gap;
  const left = Math.floor((size - textWidth) / 2);
  const top = Math.floor((size - 7 * scale) / 2);
  [...text].forEach((char, i) => {
    const rows = font[char] ?? [];
    rows.forEach((row, ry) => {
      [...row].forEach((bit, rx) => {
        if (bit !== "1") return;
        for (let py = 0; py < scale; py++)
          for (let px = 0; px < scale; px++) {
            const x = left + i * (glyphWidth + gap) + rx * scale + px;
            const y = top + ry * scale + py;
            if (x >= 0 && x < size && y >= 0 && y < size)
              blend(pixels, (y * size + x) * 4, WHITE, 1);
          }
      });
    });
  });
  return pixels;
}

// The tray icon with unread activity: the same icon with a red dot in its
// top right corner, drawn over a copy of its pixels.
export function withUnreadDot(
  bitmap: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const pixels = new Uint8Array(bitmap);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.22));
  drawDisc(pixels, width, width - radius, radius, radius, RED);
  return pixels;
}
