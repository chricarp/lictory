import assert from "node:assert/strict";
import { test } from "node:test";
import {
  identityColor,
  identityPalette,
} from "@lictory/platform/components/identity/color";

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
