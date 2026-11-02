import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assembleDrafts,
  boundSources,
  type IntakeOutput,
} from "@lictory/core/ai/intake";

const sources = [
  {
    ref: "S1",
    label: "Customer call, 2 Nov",
    text: "Acme said refunds take too long.\nThey want refunds   to be\nprocessed within one day. Also, the weather was nice.",
  },
  {
    ref: "S2",
    label: "Ticket 4812",
    text: "Customer can’t download invoices as PDF from the billing page.",
  },
];
const disciplines = [
  { id: "d-eng", name: "Engineering", description: null },
  { id: "d-sec", name: "Security", description: "Auth and data exposure" },
];
const knowledge = [
  {
    ref: "K1",
    kind: "decision" as const,
    id: "dec-1",
    key: "PAY-4",
    title: "Refunds settle asynchronously",
    revisionId: "rev-1",
    revisionNumber: 3,
    href: "/acme/items/PAY-4",
    excerpt: "Refunds settle through the provider queue.",
  },
];
const contextEntries = [
  {
    ref: "C1",
    scope: "project",
    scopeName: "Payments",
    title: "Refund SLAs",
    content: "…",
  },
];
const context = { sources, disciplines, knowledge, contextEntries };

const draft = (
  overrides: Partial<IntakeOutput["drafts"][number]> = {},
): IntakeOutput["drafts"][number] => ({
  title: "Faster refunds",
  problem: "Refunds take too long for Acme.",
  outcome: null,
  citations: [{ source: "S1", quote: "Acme said refunds take too long." }],
  inferences: [],
  openQuestions: [],
  reviewers: [],
  relatedKnowledge: [],
  contextRefs: [],
  ...overrides,
});

void test("drafts keep only excerpts found verbatim in the named source", () => {
  const { drafts, filtered } = assembleDrafts(
    {
      drafts: [
        draft({
          citations: [
            // Line breaks and spacing differ from the source: still verbatim.
            {
              source: "S1",
              quote: "They want refunds to be processed within one day.",
            },
            // Paraphrase: not in the source.
            { source: "S1", quote: "Refunds must complete within 24 hours." },
            // Real text, wrong source.
            { source: "S2", quote: "Acme said refunds take too long." },
            // Unknown source.
            { source: "S9", quote: "Acme said refunds take too long." },
          ],
        }),
      ],
      notes: null,
    },
    context,
  );
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0]!.citations, [
    {
      source: "S1",
      label: "Customer call, 2 Nov",
      quote: "They want refunds to be processed within one day.",
    },
  ]);
  assert.equal(filtered.citations, 3);
});

void test("typographic quotes in a source still match a plain excerpt", () => {
  const { drafts } = assembleDrafts(
    {
      drafts: [
        draft({
          title: "Invoice PDF",
          citations: [
            {
              source: "s2",
              quote: "Customer can't download invoices as PDF",
            },
          ],
        }),
      ],
      notes: null,
    },
    context,
  );
  assert.equal(drafts[0]?.citations[0]?.source, "S2");
});

void test("a draft without any verifiable excerpt is not proposed", () => {
  const { drafts, filtered } = assembleDrafts(
    {
      drafts: [
        draft({
          title: "Invented feature",
          citations: [{ source: "S1", quote: "Acme wants dark mode." }],
        }),
        draft({ citations: [] }),
        draft(),
      ],
      notes: "S1 also mentions the weather.",
    },
    context,
  );
  assert.deepEqual(
    drafts.map((d) => d.title),
    ["Faster refunds"],
  );
  assert.equal(filtered.drafts, 2);
});

void test("reviewers must be project disciplines and references must be given", () => {
  const { drafts, filtered } = assembleDrafts(
    {
      drafts: [
        draft({
          reviewers: [
            { discipline: "security", reason: "Refund abuse." },
            { discipline: "Legal", reason: "Not a discipline here." },
            { discipline: "Security", reason: "Duplicate." },
          ],
          relatedKnowledge: [
            { ref: "K1", reason: "May contradict asynchronous settlement." },
            { ref: "K7", reason: "Never provided." },
          ],
          contextRefs: ["C1", "C4"],
        }),
      ],
      notes: null,
    },
    context,
  );
  const [result] = drafts;
  assert.deepEqual(result!.reviewers, [
    { disciplineId: "d-sec", name: "Security", reason: "Refund abuse." },
  ]);
  assert.deepEqual(
    result!.relatedKnowledge.map((k) => [k.id, k.key, k.revisionId]),
    [["dec-1", "PAY-4", "rev-1"]],
  );
  assert.deepEqual(result!.context, [
    { ref: "C1", title: "Refund SLAs", scope: "project" },
  ]);
  assert.deepEqual(filtered, {
    drafts: 0,
    citations: 0,
    reviewers: 1,
    references: 2,
  });
});

void test("the description separates stated content, sources and inferences", () => {
  const { drafts } = assembleDrafts(
    {
      drafts: [
        draft({
          outcome: "Refunds complete within one day.",
          openQuestions: ["What happens when the provider is down?"],
          inferences: ["Acme is a merchant on the standard plan."],
          relatedKnowledge: [{ ref: "K1", reason: "Settlement is async." }],
        }),
      ],
      notes: null,
    },
    context,
  );
  const description = drafts[0]!.description;
  assert.match(description, /^## Problem\n\nRefunds take too long for Acme\./);
  assert.match(description, /## Expected outcome\n\nRefunds complete/);
  assert.match(description, /- What happens when the provider is down\?/);
  assert.match(
    description,
    /> Acme said refunds take too long\.\n>\n> — Customer call, 2 Nov/,
  );
  assert.match(
    description,
    /## Inferred, not stated in the sources\n\n- Acme is a merchant/,
  );
  assert.match(description, /\[PAY-4\]\(\/acme\/items\/PAY-4\) decision/);
  // No section that a readiness policy commonly requires is fabricated.
  assert.doesNotMatch(description, /Acceptance criteria/i);
});

void test("material is bounded and truncation is reported", () => {
  const bounded = boundSources(
    [
      { label: "", text: "a".repeat(8) },
      { label: "Empty", text: "   " },
      { label: "Long", text: "b".repeat(8) },
      { label: "Dropped", text: "c" },
    ],
    12,
  );
  assert.deepEqual(bounded, {
    sources: [
      { ref: "S1", label: "Source 1", text: "aaaaaaaa" },
      { ref: "S3", label: "Long", text: "bbbb" },
    ],
    truncated: true,
  });
  assert.equal(
    boundSources([{ label: "Notes", text: "short" }], 100).truncated,
    false,
  );
});
