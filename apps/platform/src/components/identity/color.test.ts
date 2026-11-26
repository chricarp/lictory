import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  agentColor,
  identityColor,
  identityPalette,
} from "@lictory/ui/identity-color";

void test("a person's color is the same every time it is asked for", () => {
  const id = "7a0e3c1d-5b2f-4e8a-9c6d-1f2e3a4b5c6d";
  const first = identityColor(id);
  for (let i = 0; i < 10; i++) assert.equal(identityColor(id), first);
  // Pinned: a release must not repaint everyone.
  assert.equal(identityColor("ada"), identityPalette[3]);
  assert.equal(identityColor("ben"), identityPalette[2]);
});

void test("colors come from the palette and spread over it", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const color = identityColor(`user-${i}`);
    assert.ok((identityPalette as readonly string[]).includes(color));
    seen.add(color);
  }
  assert.equal(seen.size, identityPalette.length);
});

void test("agents are never drawn in the neutral slate", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(agentColor(`agent-${i}`));
  assert.ok(!seen.has("#5f6b7a"));
  assert.equal(seen.size, identityPalette.length - 1);
  assert.equal(agentColor("forge"), agentColor("forge"));
});

void test("every palette color keeps white initials at 4.5:1", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  for (const color of identityPalette)
    assert.ok(1.05 / (luminance(color) + 0.05) >= 4.5, color);
});

// Agent tiles mix the identity color into the card (`AgentAvatar`) with the
// per-mode `--identity-*` tokens of the theme. axe cannot read `color-mix()`,
// so the glyph's contrast on its tile is computed here from the stylesheet.
void test("an agent tile's glyph keeps 4.5:1 on its tile in light and dark", () => {
  const css = readFileSync(
    fileURLToPath(
      new URL("../../../../../packages/ui/src/styles.css", import.meta.url),
    ),
    "utf8",
  );
  const block = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, selector);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const token = (text: string, name: string) => {
    const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(text);
    assert.ok(match, name);
    return match[1]!.trim();
  };
  const light = block(":root,\n[data-theme]");
  const dark = block(".dark");
  for (const [mode, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    const card = hex(token(tokens, "card"));
    const foreground = hex(token(tokens, "foreground"));
    const tile = parseFloat(token(tokens, "identity-tile")) / 100;
    const ink = parseFloat(token(tokens, "identity-ink")) / 100;
    for (const color of identityPalette) {
      const background = mix(hex(color), tile, card);
      const glyph = mix(hex(color), ink, foreground);
      const ratio = contrast(background, glyph);
      assert.ok(ratio >= 4.5, `${mode} ${color}: ${ratio.toFixed(2)}:1`);
    }
  }
});

type Rgb = [number, number, number];
const hex = (value: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as Rgb;
const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
// sRGB ↔ OKLab (Björn Ottosson), as `color-mix(in oklab, …)` mixes.
function oklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as Rgb;
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function srgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, fromLinear(c)))) as Rgb;
}
function mix(color: Rgb, amount: number, base: Rgb): Rgb {
  const x = oklab(color);
  const y = oklab(base);
  return srgb(x.map((v, i) => v * amount + y[i]! * (1 - amount)) as Rgb);
}
function contrast(x: Rgb, y: Rgb) {
  const luminance = (c: Rgb) => {
    const [r, g, b] = c.map(toLinear) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}
