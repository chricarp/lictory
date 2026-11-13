import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeUnfinished,
  splitBlocks,
} from "@lictory/platform/components/intelligence/chat/markdown-blocks";

void test("paragraphs and headings become separate blocks", () => {
  assert.deepEqual(
    splitBlocks("## Status\n\nPAY-142 is blocked.\n\nNext step."),
    ["## Status\n", "PAY-142 is blocked.\n", "Next step."],
  );
});

void test("a fenced code block with blank lines stays one block", () => {
  const code = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
  assert.deepEqual(splitBlocks(`Before\n\n${code}\n\nAfter`), [
    "Before\n",
    `${code}\n`,
    "After",
  ]);
});

void test("a loose list and indented continuations stay together", () => {
  const list = "1. First\n\n2. Second\n\n   still second";
  assert.deepEqual(splitBlocks(`${list}\n\nDone`), [`${list}\n`, "Done"]);
});

void test("joining the blocks gives back the source", () => {
  const source =
    "# A\n\nText\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- x\n- y\n\n```\nq\n\nr\n```";
  assert.equal(splitBlocks(source).join("\n"), source);
});

void test("a document with reference definitions stays whole", () => {
  const source =
    "See [the runbook][rb].\n\nMore text.\n\n[rb]: https://example.test";
  assert.deepEqual(splitBlocks(source), [source]);
});

void test("a blockquote of several paragraphs is never cut into code", () => {
  const blocks = splitBlocks("> First\n>\n> Second\n\nAfter");
  assert.deepEqual(blocks, ["> First\n>\n> Second\n", "After"]);
});

void test("streaming text closes what is still open", () => {
  assert.equal(closeUnfinished("The **Issuer"), "The **Issuer**");
  assert.equal(closeUnfinished("Use `retry"), "Use `retry`");
  assert.equal(closeUnfinished("Gone ~~old"), "Gone ~~old~~");
  assert.equal(closeUnfinished("See [the run"), "See ");
  assert.equal(closeUnfinished("See [runbook](https://exa"), "See ");
  assert.equal(
    closeUnfinished("```ts\nconst a = 1;"),
    "```ts\nconst a = 1;\n```",
  );
  assert.equal(closeUnfinished("Ends with **"), "Ends with ");
});

void test("complete text is unchanged", () => {
  for (const done of [
    "The **Issuer** decides.",
    "Use `retry` and [runbook](https://example.test).",
    "- [x] done",
    "```\na\n```",
  ])
    assert.equal(closeUnfinished(done), done);
});

void test("nested formatting closes innermost first", () => {
  assert.equal(closeUnfinished("**Use `retry"), "**Use `retry`**");
  assert.equal(closeUnfinished("*Note: **mixed"), "*Note: **mixed***");
  assert.equal(closeUnfinished("A ~~gone **bold"), "A ~~gone **bold**~~");
  assert.equal(closeUnfinished("_emphasis"), "_emphasis_");
});

void test("look-alikes of emphasis are left alone", () => {
  for (const text of [
    "- a list item",
    "* another item",
    "use snake_case_names here",
    "2 * 3 = 6",
    "`a ** b`",
    "escaped \\*star",
  ])
    assert.equal(closeUnfinished(text), text);
});

void test("delimiter runs: double-backtick code and underscore bold", () => {
  assert.equal(closeUnfinished("Use ``a ` b`` here"), "Use ``a ` b`` here");
  assert.equal(closeUnfinished("Use ``a ` b"), "Use ``a ` b``");
  assert.equal(closeUnfinished("__important"), "__important__");
  assert.equal(closeUnfinished("__done__ and more"), "__done__ and more");
  assert.equal(
    closeUnfinished("keep dunder__names__ intact"),
    "keep dunder__names__ intact",
  );
});

void test("a list item with its own paragraph keeps the list whole", () => {
  const list = "1. First\n\n   Why it matters.\n\n2. Second";
  assert.deepEqual(splitBlocks(`${list}\n\nAfter`), [`${list}\n`, "After"]);
});

void test("only a matching bare fence closes a code block", () => {
  // Trailing text, a shorter run or the other marker stay code.
  const code = "````md\n```not-a-close\n\n```\n\n~~~\n\nstill code\n````";
  assert.deepEqual(splitBlocks(`${code}\n\nAfter`), [`${code}\n`, "After"]);
  const tagged = "```\n```not-a-close\n\nstill code\n```";
  assert.deepEqual(splitBlocks(`${tagged}\n\nAfter`), [`${tagged}\n`, "After"]);
});

void test("an unfinished fence is closed with its own marker", () => {
  assert.equal(
    closeUnfinished("````md\n```ts\nx\n```"),
    "````md\n```ts\nx\n```\n````",
  );
  assert.equal(closeUnfinished("~~~\na"), "~~~\na\n~~~");
});
