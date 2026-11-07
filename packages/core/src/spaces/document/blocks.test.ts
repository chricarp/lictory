import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeDocument as canon,
  diffDocuments,
  documentHash,
  documentToDraftState,
  documentToMarkdown,
  draftStateToDocument,
  markdownToDocument,
  mergeDocuments,
  PageDocumentError,
  type PageNode,
} from "./index";
import {
  pageTemplateKinds,
  templateDocument,
} from "@lictory/core/spaces/templates";

// The blocks that show Work in a page (work lists, decision references) and
// the page templates: canonical form, Markdown export and import, and that
// documents written before them keep their exact form and hash.

const p = (id: string, ...content: PageNode[]): PageNode => ({
  type: "paragraph",
  attrs: { id },
  ...(content.length ? { content } : {}),
});
const t = (text: string): PageNode => ({ type: "text", text });
const list = (attrs: Record<string, unknown>, id = "wl"): PageNode => ({
  type: "workList",
  attrs: { id, ...attrs },
});
const doc = (...content: PageNode[]) => canon({ type: "doc", content });

void test("documents without the new blocks keep their exact canonical form and hash", () => {
  // Written with the schema before work lists existed (foundation commit
  // bf6efab0); the hash must never change for existing content.
  const old = doc(
    { type: "heading", attrs: { id: "h", level: 2 }, content: [t("Refunds")] },
    p(
      "a",
      t("See "),
      { type: "workItemRef", attrs: { workItemId: "w1", key: "PAY-1" } },
      t(" and "),
      { type: "pageRef", attrs: { pageId: "pg1" } },
    ),
    {
      type: "taskList",
      attrs: { id: "tl" },
      content: [
        {
          type: "taskItem",
          attrs: { id: "ti", checked: false },
          content: [p("tp", t("Write the runbook"))],
        },
      ],
    },
  );
  assert.equal(
    documentHash("Refund runbook", old),
    "2e6f0a4ff80c120804191caf959649a6cab04430fb44387fd88589917df490f3",
  );
  assert.deepEqual(canon(old), old);
});

void test("a work list is a canonical block with a narrow, validated filter", () => {
  const d = doc(
    list({ projectId: "p1", filter: "epic-children", filterId: "e1" }),
    list({ filter: "referenced" }, "wl2"),
  );
  assert.deepEqual(d.content![0], {
    type: "workList",
    attrs: {
      id: "wl",
      projectId: "p1",
      filter: "epic-children",
      filterId: "e1",
      title: null,
    },
  });
  assert.equal(d.content![1]!.attrs!.filter, "referenced");
  assert.deepEqual(canon(d), d);
  for (const bad of [
    { projectId: "p1", filter: "status", filterId: "s1" },
    { projectId: "p1", filter: "iteration" },
    { filter: "label", filterId: "l1" },
    { projectId: "p 1", filter: "label", filterId: "l1" },
    { projectId: "p1", filter: "label", filterId: "l1", title: 3 },
    { projectId: "p1", filter: "label", filterId: "l1", rows: 5 },
  ])
    assert.throws(() => doc(list(bad)), PageDocumentError, JSON.stringify(bad));
  // It is a block: not allowed inside a paragraph.
  assert.throws(
    () => doc(p("x", list({ filter: "referenced" }))),
    PageDocumentError,
  );
});

void test("work lists and decision references round trip through drafts, merges and diffs", () => {
  const base = doc(
    p("a", t("Intro")),
    list({ projectId: "p1", filter: "iteration", filterId: "i1" }),
    p("d", {
      type: "decisionRef",
      attrs: { decisionId: "d1", label: "Use idempotency keys" },
    }),
  );
  assert.deepEqual(draftStateToDocument(documentToDraftState(base)), base);
  const retitled = doc(
    p("a", t("Intro")),
    list({
      projectId: "p1",
      filter: "iteration",
      filterId: "i1",
      title: "Sprint 4",
    }),
    p("d", {
      type: "decisionRef",
      attrs: { decisionId: "d1", label: "Use idempotency keys" },
    }),
  );
  const edited = doc(
    p("a", t("Intro, edited")),
    list({ projectId: "p1", filter: "iteration", filterId: "i1" }),
    p("d", {
      type: "decisionRef",
      attrs: { decisionId: "d1", label: "Use idempotency keys" },
    }),
  );
  const merged = mergeDocuments({ base, ours: retitled, theirs: edited });
  assert.equal(merged.status, "clean");
  if (merged.status === "clean") {
    assert.equal(merged.document.content![1]!.attrs!.title, "Sprint 4");
    assert.equal(
      merged.document.content![0]!.content![0]!.text,
      "Intro, edited",
    );
  }
  const changes = diffDocuments(base, retitled).filter(
    (c) => c.kind !== "unchanged",
  );
  assert.deepEqual(
    changes.map((c) => [c.kind, c.blockId]),
    [["changed", "wl"]],
  );
  assert.match(changes[0]!.afterMarkdown!, /Sprint 4/);
});

void test("Markdown states a live list; an export resolves it into static references", () => {
  const d = doc(
    list({ projectId: "p1", filter: "epic-children", filterId: "e1" }),
    list({ filter: "referenced", title: "Our *work*" }, "wl2"),
    p("d", {
      type: "decisionRef",
      attrs: { decisionId: "d1", label: "Retries reuse IDs" },
    }),
  );
  assert.equal(
    documentToMarkdown(d),
    [
      "**Work in this epic** (live list in Lictory)",
      "**Our \\*work\\*** (live list in Lictory)",
      "[Retries reuse IDs](decision:d1)",
    ].join("\n\n"),
  );
  const exported = documentToMarkdown(d, {
    workList: (attrs) =>
      attrs.filter === "epic-children"
        ? {
            label: "Children of PAY-1",
            items: [
              { id: "w2", key: "PAY-2", title: "Refund [partial]" },
              { id: "w3", key: "PAY-3", title: "Retry" },
            ],
          }
        : { items: [] },
  });
  assert.equal(
    exported,
    [
      "**Children of PAY-1** (live list in Lictory)",
      "",
      "- [PAY-2](item:w2) Refund \\[partial\\]",
      "- [PAY-3](item:w3) Retry",
      "",
      "**Our \\*work\\*** (live list in Lictory)",
      "",
      "*No work items*",
      "",
      "[Retries reuse IDs](decision:d1)",
    ].join("\n"),
  );
  // Importing an export keeps references, never a live list.
  const imported = markdownToDocument(exported);
  const types = new Set<string>();
  const visit = (n: PageNode) => {
    types.add(n.type);
    n.content?.forEach(visit);
  };
  visit(imported);
  assert.ok(!types.has("workList"));
  assert.ok(types.has("bulletList"));
  assert.match(documentToMarkdown(imported), /PAY-2/);
  // Resolving never changes the stored content or its hash.
  assert.equal(documentHash("x", d), documentHash("x", canon(d)));
});

void test("every template is a small canonical document; work lists follow their context", () => {
  for (const kind of pageTemplateKinds) {
    const d = templateDocument(kind);
    assert.deepEqual(canon(d), d, kind);
    assert.ok(d.content!.length >= 1, kind);
  }
  assert.deepEqual(
    templateDocument("blank").content!.map((n) => n.type),
    ["paragraph"],
  );
  const headings = (d: PageNode) =>
    d
      .content!.filter((n) => n.type === "heading")
      .map((n) => n.content?.[0]?.text);
  assert.deepEqual(headings(templateDocument("runbook")), [
    "When to use this runbook",
    "Before you start",
    "Steps",
    "Verify",
    "Roll back",
    "Escalation",
  ]);
  const lists = (d: PageNode) =>
    d.content!.filter((n) => n.type === "workList").map((n) => n.attrs);
  // Without an iteration the notes have no live list...
  assert.deepEqual(lists(templateDocument("iteration-notes")), []);
  // ...with one, they list the iteration's work.
  assert.deepEqual(
    lists(
      templateDocument("iteration-notes", {
        projectId: "p1",
        iterationId: "i1",
      }),
    ).map((a) => ({ ...a, id: undefined })),
    [
      {
        id: undefined,
        projectId: "p1",
        filter: "iteration",
        filterId: "i1",
        title: null,
      },
    ],
  );
  assert.equal(
    lists(
      templateDocument("product-requirements", {
        projectId: "p1",
        epicId: "e1",
      }),
    )[0]?.filter,
    "epic-children",
  );
  // No template starts with an empty bullet, step or task: it would read
  // as a lone marker in the published page.
  const emptyItems = (n: PageNode): number =>
    (["listItem", "taskItem"].includes(n.type) &&
    !n.content?.some((c) => c.content?.length)
      ? 1
      : 0) + (n.content ?? []).reduce((sum, c) => sum + emptyItems(c), 0);
  for (const kind of pageTemplateKinds)
    assert.equal(emptyItems(templateDocument(kind)), 0, kind);
  // Block ids are fresh for every new page.
  const [a, b] = [
    templateDocument("design-doc"),
    templateDocument("design-doc"),
  ];
  assert.notEqual(a.content![0]!.attrs!.id, b.content![0]!.attrs!.id);
});
