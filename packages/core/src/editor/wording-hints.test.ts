import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownSchema } from "@lictory/core/editor/schema";
import { parseMarkdown } from "@lictory/core/editor/markdown";
import {
  findWordingHints,
  wordingHintsInDocument,
} from "@lictory/core/editor/wording-hints";

const phrases = (text: string) => findWordingHints(text).map((h) => h.phrase);
const docOf = (markdown: string) =>
  markdownSchema.nodeFromJSON(parseMarkdown(markdown).doc);

test("flags phrases a tester cannot turn into pass or fail", () => {
  assert.deepEqual(phrases("Search results appear quickly."), ["quickly"]);
  assert.deepEqual(phrases("The checkout flow is intuitive."), ["intuitive"]);
  assert.deepEqual(
    phrases("The system shows an appropriate error when the upload fails."),
    ["appropriate"],
  );
  assert.deepEqual(phrases("Timeout behavior: TBD"), ["TBD"]);
  assert.deepEqual(phrases("Data retention period: to be decided"), [
    "to be decided",
  ]);
  assert.deepEqual(phrases("Retry count: ???"), ["???"]);
  assert.deepEqual(phrases("The import handles CSV, XLSX, etc."), ["etc."]);
  assert.deepEqual(phrases("Notifications go by email, push and so on."), [
    "and so on",
  ]);
  assert.deepEqual(phrases("Admins can bulk-edit users if possible."), [
    "if possible",
  ]);
  assert.deepEqual(phrases("Data is cached where appropriate."), [
    "where appropriate",
  ]);
  assert.equal(findWordingHints("Login is fast.")[0]?.kind, "unmeasurable");
});

test("does not flag ordinary words that only look vague", () => {
  for (const precise of [
    // Words Codex warned about: not defects in themselves.
    "Users should receive a confirmation email.",
    "All refunds above 500 EUR wait for a finance approver.",
    "The admin and/or the owner can delete the project.",
    "Retries reuse the idempotency key of the first attempt.",
    "Some limits apply to trial accounts.",
    // Measured criteria keep their adjectives.
    "Search is fast: the first page returns within 500 ms at p95.",
    "The API answers with an appropriate status (409).",
    // Names, compounds, quotes and code.
    "The fast-forward option is hidden when the branch has diverged.",
    'The "Fast checkout" button is shown only with a saved card.',
    "The Quick add menu lists recent projects.",
    "The robust-mode flag is off by default.",
    "The `etc` directory is never exported.",
    "Config is read from /etc/lictory.yml.",
    // "possible" describing a noun.
    "If possible duplicates are found, the user is asked to merge them.",
  ])
    assert.deepEqual(phrases(precise), [], precise);
});

test("the repository's own acceptance criteria raise no hints", () => {
  for (const criterion of [
    "A partial refund of 10.00 on a 25.00 payment leaves 15.00 refundable",
    "A refund without a reason code is rejected.",
    "A retried capture never creates a second payment intent.",
    "Duplicate callbacks do not create duplicate cancellations",
    "Late responses return within 60 seconds.",
    "Refunds never exceed the settled amount.",
    "Retries stop when the card network reports a hard decline.",
    "Timeout after 30s",
    "Two concurrent refunds never exceed the captured amount",
  ])
    assert.deepEqual(phrases(criterion), [], criterion);
});

test("only the Acceptance criteria section is read, at any heading level", () => {
  const markdown = [
    "# Intent",
    "",
    "Checkout should feel fast and intuitive.",
    "",
    "## Acceptance criteria",
    "",
    "- Search results appear quickly.",
    "- Retries reuse the id.",
    "",
    "### Edge cases",
    "",
    "Timeout: TBD",
    "",
    "## Failure behavior",
    "",
    "Errors are handled gracefully.",
  ].join("\n");
  const doc = docOf(markdown);
  const hints = wordingHintsInDocument(doc);
  assert.deepEqual(
    hints.map((h) => h.phrase),
    ["quickly", "TBD"],
  );
  // Positions address the phrase in the document.
  for (const h of hints) assert.equal(doc.textBetween(h.pos, h.end), h.phrase);
  assert.equal(hints[0]!.criterion, "Search results appear quickly.");
  assert.deepEqual(wordingHintsInDocument(docOf("Only fast here.")), []);
});

test("positions skip references, inline code and code blocks", () => {
  const doc = docOf(
    [
      "## Acceptance Criteria:",
      "",
      "- [PAY-2](item:00000000-0000-4000-8000-000000000001) loads quickly; `etc` is a path.",
      "",
      "```",
      "TBD",
      "```",
    ].join("\n"),
  );
  const hints = wordingHintsInDocument(doc);
  assert.deepEqual(
    hints.map((h) => h.phrase),
    ["quickly"],
  );
  assert.equal(doc.textBetween(hints[0]!.pos, hints[0]!.end), "quickly");
});

test("scanning a long specification stays well under a frame", () => {
  // 1,500 criteria with three hints each; typing changes one block, and
  // ProseMirror reuses every other node, whose hints are cached.
  const criteria = Array.from(
    { length: 1500 },
    () => "- The export is reasonably fast and robust for every account.",
  );
  const markdown = `# Intent\n\nText.\n\n## Acceptance criteria\n\n${criteria.join("\n")}\n`;
  const doc = docOf(markdown);
  const cold = performance.now();
  assert.equal(wordingHintsInDocument(doc).length, 4500);
  const coldMs = performance.now() - cold;
  const warm = performance.now();
  for (let i = 0; i < 20; i++) wordingHintsInDocument(doc);
  const warmMs = (performance.now() - warm) / 20;
  // Generous bounds for loaded CI hosts; measured locally: see the PR.
  assert.ok(coldMs < 250, `cold scan took ${coldMs.toFixed(1)} ms`);
  assert.ok(warmMs < 16, `cached scan took ${warmMs.toFixed(1)} ms`);
});
