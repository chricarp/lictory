import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageNode } from "@lictory/core/spaces/document/canonical";
import { quoteOccursIn } from "@lictory/core/spaces/source-quote";

// A quote attributed to a page version must be its text.

const text = (value: string): PageNode => ({ type: "text", text: value });
const paragraph = (id: string, ...content: PageNode[]): PageNode => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const doc: PageNode = {
  type: "doc",
  content: [
    paragraph(
      "a",
      text("Refunds after settlement"),
      { type: "hardBreak" },
      text("are undefined."),
    ),
    paragraph("empty"),
    {
      type: "bulletList",
      attrs: { id: "list" },
      content: [
        {
          type: "listItem",
          attrs: { id: "li" },
          content: [
            paragraph(
              "li-p",
              text("Ask "),
              {
                type: "decisionRef",
                attrs: { decisionId: "d", label: "Reuse payments" },
              },
              text(" first."),
            ),
          ],
        },
      ],
    },
  ],
};

void test("a quote is the page's words, wherever whitespace falls", () => {
  assert.ok(quoteOccursIn(doc, "settlement\nare undefined.", "a"));
  assert.ok(quoteOccursIn(doc, "settlementare undefined.", "a"));
  assert.ok(quoteOccursIn(doc, "undefined.\n\n\nAsk Reuse payments", "a"));
  assert.ok(quoteOccursIn(doc, "Ask  first.", "list"));
  assert.ok(quoteOccursIn(doc, "Ask Reuse payments first.", null));
});

void test("invented words, another block or an unknown block are refused", () => {
  assert.equal(
    quoteOccursIn(doc, "Refunds after settlement are free.", null),
    false,
  );
  assert.equal(quoteOccursIn(doc, "Ask", "a"), false);
  assert.equal(quoteOccursIn(doc, "Ask", "empty"), false);
  assert.equal(quoteOccursIn(doc, "Refunds", "missing"), false);
  assert.equal(quoteOccursIn(doc, "   ", null), false);
});
