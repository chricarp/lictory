import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLLAPSE_DISTANCE,
  maxWidth,
  paneWidthCss,
  resolveDrag,
} from "@lictory/platform/lib/pane-width";

const bounds = { min: 240, max: 560, preferred: 320, collapsible: false };

void test("a drag follows the pointer between the pane's limits", () => {
  assert.deepEqual(resolveDrag(410.4, bounds), {
    width: 410,
    collapsed: false,
  });
  assert.equal(resolveDrag(900, bounds).width, 560);
  assert.equal(resolveDrag(100, bounds).width, 240);
});

void test("a drag near the default width settles on it", () => {
  assert.equal(resolveDrag(326, bounds).width, 320);
  assert.equal(resolveDrag(313, bounds).width, 320);
  assert.equal(resolveDrag(340, bounds).width, 340);
});

void test("only collapsible panes fold when dragged well past the minimum", () => {
  const past = bounds.min - COLLAPSE_DISTANCE - 1;
  assert.deepEqual(resolveDrag(past, bounds), {
    width: 240,
    collapsed: false,
  });
  assert.deepEqual(resolveDrag(past, { ...bounds, collapsible: true }), {
    width: 240,
    collapsed: true,
  });
  // Short of the fold distance it rests at the minimum instead.
  assert.equal(
    resolveDrag(bounds.min - 10, { ...bounds, collapsible: true }).collapsed,
    false,
  );
});

void test("a pane grows only as far as its neighbour can give", () => {
  const limits = { current: 300, min: 240, max: 560, share: 480 };
  assert.equal(maxWidth({ ...limits, room: Infinity }), 480);
  assert.equal(maxWidth({ ...limits, room: 100 }), 400);
  // A neighbour already at its minimum lets the pane shrink, not grow.
  assert.equal(maxWidth({ ...limits, room: -50 }), 300);
  assert.equal(maxWidth({ ...limits, current: 200, room: -50 }), 240);
});

void test("a chosen width gives way to the pane's share of the space", () => {
  assert.equal(
    paneWidthCss(420.6, "max(30cqw, 272px)"),
    "min(421px, max(30cqw, 272px))",
  );
});
