import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The theme's color tokens, read from the stylesheet itself: every block that
// defines a palette (Lictory and each personal theme, light and dark).
const css = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);
const palettes = [...css.matchAll(/\n([^\n{}@/]+?)\s*\{([^}]*)\}/g)]
  .map(([, selector, body]) => ({
    selector: selector!.replace(/\s+/g, " ").trim(),
    tokens: Object.fromEntries(
      [...body!.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
        ([, name, value]) => [name!, value!],
      ),
    ),
  }))
  .filter(({ tokens }) => tokens.foreground && tokens.input);

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

void test("every theme defines its palette in light and dark", () => {
  // Lictory plus five personal themes, each once per mode.
  assert.equal(palettes.length, 12, palettes.map((p) => p.selector).join());
});

// WCAG 1.4.11: a person must be able to find where a field starts and ends.
// `--input` draws the edge of text fields, selects and radios, the off track
// of a switch and the selected segment, so it needs 3:1 on every surface those
// controls sit on.
void test("field and control edges keep 3:1 on every surface, in every theme", () => {
  for (const { selector, tokens } of palettes)
    for (const surface of ["background", "card", "popover", "muted"]) {
      const color = tokens[surface];
      if (!color) continue;
      const ratio = contrast(tokens.input!, color);
      assert.ok(
        ratio >= 3,
        `${selector} input on ${surface}: ${ratio.toFixed(2)}:1`,
      );
    }
});
