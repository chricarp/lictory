// An organization's brand color: one color, from which the application
// derives everything it tints (primary actions, accents, email buttons and
// links). Administrators choose the color; Lictory keeps it readable.

// Stored and exchanged as lowercase #rrggbb.
export const brandColorPattern = /^#[0-9a-f]{6}$/;

export function normalizeBrandColor(value: string) {
  const color = value.trim().toLowerCase();
  return brandColorPattern.test(color) ? color : null;
}

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const hex = (color: Rgb) =>
  `#${color.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function luminance(color: Rgb) {
  const [r, g, b] = color.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 contrast ratio between two #rrggbb colors.
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(rgb(a)), luminance(rgb(b))].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

const mix = (from: Rgb, to: Rgb, amount: number): Rgb =>
  from.map((c, i) => c + (to[i]! - c) * amount) as Rgb;

// The brand color moved toward `toward` just far enough to reach `ratio`
// against `surface`; unchanged when it already does.
function readable(color: string, surface: string, toward: Rgb, ratio: number) {
  if (contrast(color, surface) >= ratio) return color;
  const from = rgb(color);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 12; i++) {
    const middle = (low + high) / 2;
    if (contrast(hex(mix(from, toward, middle)), surface) >= ratio)
      high = middle;
    else low = middle;
  }
  return hex(mix(from, toward, high));
}

// The surfaces brand-colored text can sit on with the least contrast: the
// light shell and the dark popover (packages/ui/src/styles.css).
const LIGHT_SURFACE = "#f2f3f5";
const DARK_SURFACE = "#212226";
const LIGHT_FOREGROUND = "#ffffff";
const DARK_FOREGROUND = "#111214";
// WCAG 2.2 AA for text, with a margin for rounding.
const RATIO = 4.6;

export type BrandTone = { color: string; foreground: string };
export type BrandPalette = { light: BrandTone; dark: BrandTone };

// What the interface uses for a brand color. A color too pale for light
// surfaces is darkened and one too dark for dark surfaces is lightened, until
// it reads at 4.5:1 both as text on the surface and behind its foreground.
// Email uses the light tone.
export function brandPalette(color: string): BrandPalette {
  return {
    light: {
      color: readable(color, LIGHT_SURFACE, [0, 0, 0], RATIO),
      foreground: LIGHT_FOREGROUND,
    },
    dark: {
      color: readable(color, DARK_SURFACE, [255, 255, 255], RATIO),
      foreground: DARK_FOREGROUND,
    },
  };
}
