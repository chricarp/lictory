import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptanceCriteria,
  criteriaToRead,
  normalizeReadings,
  renderReadings,
  type ModelReading,
} from "@lictory/core/ai/readings";
import {
  parseMarkdownTree,
  placeQuote,
  textModel,
} from "@lictory/core/editor/markdown-text";

const spec = [
  "Retry the payment when the provider times out.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] A timed-out payment is retried **at most twice**.",
  "- [ ] The customer sees one charge.",
  "  - Refunds are listed separately.",
  "- [ ] The customer sees one charge.",
  "",
  "### Failure cases",
  "",
  "- The customer sees one charge.",
  "",
  "## Rollout",
  "",
  "- Not a criterion either.",
].join("\n");

void test("criteria are the rendered list items under the acceptance criteria heading, each placeable by the reader", () => {
  const criteria = acceptanceCriteria(spec);
  assert.deepEqual(
    criteria.map((c) => c.text),
    [
      "A timed-out payment is retried at most twice.",
      "The customer sees one charge.",
      "Refunds are listed separately.",
      "The customer sees one charge.",
      "The customer sees one charge.",
    ],
  );
  assert.deepEqual(
    criteria.map((c) => [c.section, c.occurrence]),
    [
      ["Acceptance criteria", 0],
      ["Acceptance criteria", 0],
      ["Acceptance criteria", 0],
      ["Acceptance criteria", 1],
      ["Failure cases", 0],
    ],
  );
  // Every anchor lands on its own copy of the text, as the reader shows it.
  const model = textModel(parseMarkdownTree(spec));
  const placed = criteria.map((c) =>
    placeQuote(model, { ...c, quote: c.text }),
  );
  assert.ok(placed.every((p) => p.kind === "found"));
  const ranges = placed.map((p) => (p.kind === "found" ? p.from : -1));
  assert.equal(new Set(ranges).size, 5, "duplicates anchor to distinct copies");
  assert.equal(
    model.text.slice(ranges[0], ranges[0]! + 45),
    "A timed-out payment is retried at most twice.",
  );
});

void test("without a list, paragraphs are criteria; without the heading, there are none", () => {
  assert.deepEqual(
    acceptanceCriteria(
      "# Acceptance Criteria:\n\nGiven a timeout, the payment is retried.\n\nRefunds are separate.",
    ).map((c) => c.text),
    ["Given a timeout, the payment is retried.", "Refunds are separate."],
  );
  assert.deepEqual(acceptanceCriteria("Retry on timeout.\n\n- One charge"), []);
});

void test("a pull request reads only the criteria it adds or rewords, plus those still under discussion", () => {
  const base =
    "## Acceptance criteria\n\n- A payment is retried.\n- One charge.\n- Receipts are emailed.";
  const head =
    "## Acceptance criteria\n\n- A payment is retried at most twice.\n- One  charge.\n- Receipts are emailed.\n- Refunds are separate.";
  assert.deepEqual(
    criteriaToRead(base, head).criteria.map((c) => [c.ref, c.text]),
    [
      ["A1", "A payment is retried at most twice."],
      ["A2", "Refunds are separate."],
    ],
    "whitespace-only changes are not rewording",
  );
  assert.deepEqual(
    criteriaToRead(base, head, ["Receipts are emailed."]).criteria.map(
      (c) => c.text,
    ),
    [
      "A payment is retried at most twice.",
      "Receipts are emailed.",
      "Refunds are separate.",
    ],
  );
  const many = `## Acceptance criteria\n\n${Array.from({ length: 25 }, (_, i) => `- Case ${i}`).join("\n")}`;
  const read = criteriaToRead("", many);
  assert.equal(read.criteria.length, 20);
  assert.equal(read.truncated, true);
});

const reading = (over: Partial<ModelReading> = {}): ModelReading => ({
  criterionRef: "A1",
  qa: [
    {
      situation: "Provider times out three times",
      expected: "Two retries, then failure",
    },
  ],
  implementer: {
    builds: "A retry loop with three attempts",
    done: "Three attempts are made",
  },
  diverges: true,
  divergence: "QA expects two retries; the build makes three attempts.",
  question: "Does “at most twice” count the first attempt?",
  severity: "major",
  previousFindingId: null,
  ...over,
});

void test("model readings are validated: only explained divergences on sent criteria become findings, capped below blocker", () => {
  const criteria = criteriaToRead(
    "",
    "## Acceptance criteria\n\n- Retried at most twice.\n- One charge.\n- Receipts are emailed.",
  ).criteria;
  const previous = new Map<string, string>();
  const result = normalizeReadings(
    [
      reading({ severity: "blocker", previousFindingId: "f3" }),
      reading({ criterionRef: "a1" }), // duplicate criterion
      reading({ criterionRef: "A2", diverges: false, divergence: null }),
      reading({ criterionRef: "A3", divergence: "  " }), // unexplained
      reading({ criterionRef: "A9" }), // never sent
      reading({ criterionRef: "A3", qa: [] }), // no QA reading
    ],
    criteria,
    { workItemId: "item", firstId: 4, max: 25, previous },
  );
  assert.equal(result.findings.length, 1);
  const [f] = result.findings;
  assert.equal(f!.id, "f4");
  assert.equal(f!.severity, "major", "never blocker");
  assert.equal(f!.category, "ambiguity");
  assert.deepEqual(f!.evidence, ["Retried at most twice."]);
  assert.equal(f!.readings?.criterion, "Retried at most twice.");
  assert.equal(result.anchors.get("f4")?.text, "Retried at most twice.");
  assert.equal(previous.get("f4"), "f3");
  // A1, A2 and A3 had complete readings (A3's divergence was unexplained).
  assert.equal(result.read, 3);
  assert.equal(
    normalizeReadings([reading()], criteria, {
      workItemId: "item",
      firstId: 1,
      max: 0,
    }).findings.length,
    0,
    "divergences share the run's finding budget",
  );
});

void test("the discussion body shows both readings and says they come from one model", () => {
  const body = renderReadings({
    criterion: "Retried at most twice.",
    qa: [{ situation: "Three timeouts", expected: "Two retries" }],
    implementer: { builds: "Three attempts", done: "Attempts stop at three" },
    divergence: "Different counts.",
  });
  assert.match(body, /QA would test[\s\S]*Three timeouts → Two retries/);
  assert.match(body, /implementer would build[\s\S]*Three attempts/);
  assert.match(body, /one model/);
});
