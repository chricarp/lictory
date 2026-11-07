import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeDocument,
  documentToMarkdown,
} from "@lictory/core/spaces/document";
import { referencesInDocument } from "@lictory/core/contracts/references";
import { iterationNotesDocument } from "@lictory/platform/data/iteration-notes";

void test("iteration notes are a valid page listing the iteration's items as references", () => {
  const doc = canonicalizeDocument(
    iterationNotesDocument({
      label: "Sprint 3",
      goal: "Retry captures safely",
      items: [
        { id: "item-1", key: "PAY-2", title: "Retry failed card captures" },
        { id: "item-2", key: "PAY-4", title: "Duplicate capture" },
      ],
    }),
  );
  const markdown = documentToMarkdown(doc);
  assert.match(markdown, /## Goal\n\nRetry captures safely/);
  assert.match(markdown, /## Retrospective/);
  assert.deepEqual(
    referencesInDocument(doc)
      .filter((r) => r.kind === "item")
      .map((r) => r.id),
    ["item-1", "item-2"],
  );
});

void test("an empty iteration says so instead of an empty list", () => {
  const doc = canonicalizeDocument(
    iterationNotesDocument({ label: "Cycle 7", goal: null, items: [] }),
  );
  assert.match(documentToMarkdown(doc), /Nothing is planned in Cycle 7 yet\./);
});
