import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brandPalette,
  contrast,
  normalizeBrandColor,
} from "@lictory/core/branding/color";

void test("brand colors are six hexadecimal digits, stored lowercase", () => {
  assert.equal(normalizeBrandColor(" #1D4ED8 "), "#1d4ed8");
  for (const invalid of ["", "#fff", "1d4ed8", "#1d4ed8ff", "red", "#gggggg"])
    assert.equal(normalizeBrandColor(invalid), null);
});

void test("a readable brand color is used as chosen", () => {
  const palette = brandPalette("#1d4ed8");
  assert.equal(palette.light.color, "#1d4ed8");
  // Too dark for dark surfaces: lightened there only.
  assert.notEqual(palette.dark.color, "#1d4ed8");
});

void test("every brand color stays readable as text and behind its foreground, in light and dark", () => {
  const channels = ["00", "33", "66", "99", "cc", "ff"];
  const colors = channels.flatMap((r) =>
    channels.flatMap((g) => channels.map((b) => `#${r}${g}${b}`)),
  );
  for (const color of colors) {
    const { light, dark } = brandPalette(color);
    for (const surface of ["#ffffff", "#f2f3f5", "#f4f4f6"])
      assert.ok(
        contrast(light.color, surface) >= 4.5,
        `${color} on ${surface}`,
      );
    for (const surface of ["#0c0d0f", "#141518", "#1b1c20", "#212226"])
      assert.ok(contrast(dark.color, surface) >= 4.5, `${color} on ${surface}`);
    assert.ok(contrast(light.color, light.foreground) >= 4.5, color);
    assert.ok(contrast(dark.color, dark.foreground) >= 4.5, color);
  }
});
