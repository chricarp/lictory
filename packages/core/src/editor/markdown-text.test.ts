import assert from "node:assert/strict";
import { test } from "node:test";
import type { Nodes } from "mdast";
import {
  markText,
  occurrenceIn,
  parseMarkdownTree,
  placeQuote,
  textModel,
} from "@lictory/core/editor/markdown-text";
import { diffMarkdown } from "@lictory/core/editor/markdown-diff";

const spec = `# Behavior

Retries reuse the original transaction ID.

- Late answers are reconciled
- Duplicate callbacks are ignored

## Failure behavior

Retries reuse the original transaction ID. Timeouts after 30 seconds.
`;

const toString = (node: Nodes): string =>
  "value" in node && typeof node.value === "string"
    ? node.value
    : "children" in node
      ? node.children.map((c) => toString(c as Nodes)).join("")
      : "";
const model = (markdown: string) => textModel(parseMarkdownTree(markdown));
const quoted = (markdown: string, placement: ReturnType<typeof placeQuote>) =>
  placement.kind === "found"
    ? model(markdown).text.slice(placement.from, placement.to)
    : placement.kind;

void test("a quote is found under its heading, at the occurrence that was selected", () => {
  const text = model(spec);
  const under = (section: string, occurrence?: number) =>
    placeQuote(text, {
      quote: "Retries reuse the original transaction ID.",
      section,
      occurrence,
    });
  const behavior = under("Behavior");
  const failure = under("Failure behavior");
  assert.equal(behavior.kind, "found");
  assert.equal(failure.kind, "found");
  assert.ok(
    failure.kind === "found" &&
      behavior.kind === "found" &&
      failure.from > behavior.from,
    "the same words under another heading are a different passage",
  );
  // Whitespace the reader collapses does not matter, across blocks either.
  assert.equal(
    quoted(
      spec,
      placeQuote(text, {
        quote: "reconciled  Duplicate callbacks",
        section: "Behavior",
      }),
    ),
    "reconciled\nDuplicate callbacks",
  );
});

void test("a quote that moved to another heading is found only when it is unique", () => {
  const moved = `# Scope\n\nTimeouts after 30 seconds.\n\n# Other\n\nSomething else.`;
  assert.equal(
    quoted(
      moved,
      placeQuote(model(moved), {
        quote: "Timeouts after 30 seconds.",
        section: "Failure behavior",
      }),
    ),
    "Timeouts after 30 seconds.",
  );
  const twice = `# A\n\nSame words.\n\n# B\n\nSame words.`;
  assert.deepEqual(
    placeQuote(model(twice), { quote: "Same words.", section: "Gone" }),
    { kind: "removed" },
  );
});

void test("a missing quote reads as changed while its section exists, removed otherwise", () => {
  const text = model(spec);
  assert.deepEqual(
    placeQuote(text, { quote: "No such sentence", section: "Behavior" }),
    { kind: "changed" },
  );
  assert.deepEqual(
    placeQuote(text, { quote: "No such sentence", section: "" }),
    { kind: "changed" },
  );
  assert.deepEqual(
    placeQuote(text, { quote: "No such sentence", section: "Rollout" }),
    { kind: "removed" },
  );
});

void test("the occurrence of a selection counts earlier copies under its heading", () => {
  assert.equal(occurrenceIn("ID. More text ID.", "ID."), 1);
  assert.equal(occurrenceIn("Retries reuse  the ID", "the ID"), 0);
});

void test("marking wraps exactly the ranges and leaves the readable text intact", () => {
  const source = "Late **answers** are `reconciled` here.";
  const tree = parseMarkdownTree(source);
  const text = textModel(tree);
  const from = text.text.indexOf("answers are");
  markText(
    text,
    [{ from, to: from + "answers are reconciled".length, data: "t1" }],
    (children, data): Nodes => ({
      type: "emphasis",
      data: { hName: "mark", hProperties: { title: data.join(" ") } },
      children,
    }),
  );
  assert.equal(toString(tree), "Late answers are reconciled here.");
  const marks: string[] = [];
  const walk = (node: Nodes) => {
    if (node.data?.hName === "mark") marks.push(toString(node));
    if ("children" in node) node.children.forEach((c) => walk(c));
  };
  walk(tree);
  assert.deepEqual(marks, ["answers", " are ", "reconciled"]);
});

void test("block diffs pair an edited block and mark only its changed words", () => {
  const before = `# Behavior\n\nRetries reuse the original transaction ID.\n\nUnchanged paragraph.`;
  const after = `# Behavior\n\nRetries reuse the first transaction ID.\n\nUnchanged paragraph.\n\nNew paragraph.`;
  const changes = diffMarkdown(before, after);
  assert.deepEqual(
    changes.map((c) => c.kind),
    ["unchanged", "changed", "unchanged", "added"],
  );
  const edit = changes[1]!;
  assert.ok(edit.kind === "changed");
  const words = (source: string, ranges: { from: number; to: number }[]) =>
    ranges.map((r) => model(source).text.slice(r.from, r.to));
  assert.deepEqual(words(edit.before.source, edit.words.before), ["original"]);
  assert.deepEqual(words(edit.after.source, edit.words.after), ["first"]);
  assert.deepEqual(diffMarkdown(after, after), [
    {
      kind: "unchanged",
      source: after,
      blocks: changes
        .flatMap((c) =>
          c.kind === "changed"
            ? [c.after]
            : c.kind === "removed"
              ? []
              : c.blocks,
        )
        .map((b) => ({ ...b })),
    },
  ]);
});

void test("blocks of another type are removed and added, not compared word by word", () => {
  const changes = diffMarkdown("Intro.\n\nTail.", "- Intro.\n\nTail.");
  assert.deepEqual(
    changes.map((c) => c.kind),
    ["removed", "added", "unchanged"],
  );
});
