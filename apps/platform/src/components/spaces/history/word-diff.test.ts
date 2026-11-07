import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { changedWords } from "./word-diff";
const marked = (text: string, spans: { from: number; to: number }[]) =>
  spans.map((s) => text.slice(s.from, s.to));
void describe("review word comparison", () => {
  void test("highlights separate edits without marking retained context", () => {
    const a = "Retry three times, then alert operations.",
      b = "Retry five times, then notify operations.";
    const result = changedWords(a, b);
    assert.deepEqual(marked(a, result.before), ["three", "alert"]);
    assert.deepEqual(marked(b, result.after), ["five", "notify"]);
  });
  void test("preserves Unicode, punctuation and whitespace offsets", () => {
    const a = "Réessayer café!",
      b = "Réessayer thé?";
    const result = changedWords(a, b);
    assert.deepEqual(marked(a, result.before), ["café!"]);
    assert.deepEqual(marked(b, result.after), ["thé?"]);
    assert.deepEqual(changedWords(a, a), { before: [], after: [] });
  });
  void test("handles insertions and deletions", () => {
    assert.deepEqual(changedWords("", "New text"), {
      before: [],
      after: [{ from: 0, to: 8 }],
    });
    assert.deepEqual(changedWords("Old text", ""), {
      before: [{ from: 0, to: 8 }],
      after: [],
    });
  });
  void test("marks whole phrases, never their surrounding spaces", () => {
    const a = "Retry a failed capture three times with backoff.",
      b = "Retry a failed capture up to four times with backoff and jitter.";
    const result = changedWords(a, b);
    assert.deepEqual(marked(a, result.before), ["three"]);
    assert.deepEqual(marked(b, result.after), ["up to four", "and jitter"]);
    for (const span of marked(b, result.after)) assert.equal(span, span.trim());
  });
  void test("bounds comparisons for large replacements", () => {
    const a = "old ".repeat(1000),
      b = "new ".repeat(1000);
    assert.ok(changedWords(a, b).before.length > 0);
  });
});
