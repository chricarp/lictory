import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  previewKind,
  previewLabels,
  socialPreviewHead,
  socialPreviewImagePath,
  type PreviewKind,
} from "@lictory/core/lib/social-preview-kind";

void test("preview kinds follow the platform URL map", () => {
  const cases: [string, string][] = [
    ["/", "workspace"],
    ["/sign-in?callbackUrl=/acme", "workspace"],
    ["/invitation?id=1", "workspace"],
    ["/acme", "workspace"],
    ["/acme/settings/members", "workspace"],
    ["/acme/items/42", "item"],
    ["/acme/pay", "project"],
    ["/acme/pay/epics/1", "epic"],
    ["/acme/pay/epics", "workspace"],
    ["/acme/pay/stories/1", "story"],
    ["/acme/pay/reviews", "reviews"],
    ["/acme/pay/views/mine", "view"],
    ["/acme/pay/board?team=x", "board"],
    ["/acme/pay/backlog", "backlog"],
    ["/acme/pay/iterations/3", "iteration"],
  ];
  for (const [path, kind] of cases) assert.equal(previewKind(path), kind, path);
});

void test("the document head carries only the closed vocabulary", () => {
  const head = socialPreviewHead(
    '/acme/pay/epics/"><script>alert(1)</script>',
    "https://work.example.org/",
  );
  assert.match(head, /<title>Epic in Lictory<\/title>/);
  assert.match(
    head,
    /content="https:\/\/work\.example\.org\/social\/epic\.png"/,
  );
  // noindex comes once, from the SPA document (checked in the browser suite).
  assert.doesNotMatch(head, /robots/);
  assert.doesNotMatch(head, /<script|acme/);
});

void test("the platform ships a preview card for every kind of page", () => {
  for (const kind of Object.keys(previewLabels) as PreviewKind[]) {
    const file = new URL(
      `../../../ui/public${socialPreviewImagePath(kind)}`,
      import.meta.url,
    );
    const bytes = readFileSync(file);
    // PNG signature: link preview crawlers do not render SVG.
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], kind);
  }
});
