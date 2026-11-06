import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeDocument as canon,
  documentHash,
  documentToMarkdown,
  documentToDraftState,
  draftStateToDocument,
  emptyDocument,
  markdownToDocument,
  mergeDocuments,
  resolveMerge,
  diffDocuments,
  pageSchema,
  pageExtensions,
  isSafePageLink,
  PAGE_SCHEMA_VERSION,
  PageDocumentError,
  type PageNode,
  type MergeResult,
} from "./index";
const p = (id: string, text = id): PageNode => ({
  type: "paragraph",
  attrs: { id },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const doc = (...content: PageNode[]): PageNode =>
  canon({ type: "doc", content });
const merge = (base: PageNode, ours: PageNode, theirs: PageNode) =>
  mergeDocuments({ base, ours, theirs });
function conflicts(r: MergeResult) {
  assert.equal(r.status, "conflicts");
  if (r.status !== "conflicts") throw Error();
  return r;
}
const list = (nested = false, text = "hello"): PageNode => ({
  type: "bulletList",
  attrs: { id: "list" },
  content: [
    {
      type: "listItem",
      attrs: { id: "item" },
      content: [
        p("lp", text),
        ...(nested
          ? [
              {
                type: "bulletList",
                attrs: { id: "nested" },
                content: [
                  { type: "listItem", attrs: { id: "ni" }, content: [p("np")] },
                ],
              },
            ]
          : []),
      ],
    },
  ],
});
void test("shared schema loads headlessly and assigns stable unique block identities", () => {
  assert.equal(PAGE_SCHEMA_VERSION, 1);
  assert.ok(pageExtensions().length);
  assert.ok(pageSchema.nodes.pageRef);
  const d = doc(p("same"), p("same"), { type: "paragraph" });
  assert.equal(d.content![0]!.attrs!.id, "same");
  assert.equal(new Set(d.content!.map((n) => n.attrs!.id)).size, 3);
  assert.deepEqual(canon(d), d);
  assert.equal(emptyDocument().content![0]!.type, "paragraph");
});
void test("rejects unsupported nodes, marks, attributes, structures and unsafe references", () => {
  for (const n of [
    { type: "mystery" },
    { ...p("a"), attrs: { id: "a", hidden: true } },
    { type: "heading", attrs: { level: 4 } },
    {
      type: "paragraph",
      content: [{ type: "text", text: "x", marks: [{ type: "nope" }] }],
    },
    { type: "image", attrs: { src: "javascript:alert(1)" } },
    { type: "pageRef" },
    { type: "table", content: [p("p")] },
  ])
    assert.throws(() => doc(n), PageDocumentError);
  assert.doesNotThrow(() =>
    doc(
      { type: "image", attrs: { src: "/api/files/file-1" } },
      {
        type: "image",
        attrs: { src: "https://example.com/a.png", alt: "a", title: "b" },
      },
    ),
  );
});
void test("the editor, Markdown import and canonical documents keep the same links", () => {
  const linked = (href: string) =>
    doc({
      type: "paragraph",
      content: [
        { type: "text", text: "x", marks: [{ type: "link", attrs: { href } }] },
      ],
    });
  const element = (href: string) =>
    ({
      getAttribute: (name: string) => (name === "href" ? href : null),
    }) as unknown as HTMLElement;
  const pasted = (href: string) =>
    pageSchema.marks.link!.spec.parseDOM!.some(
      (rule) => "getAttrs" in rule && rule.getAttrs?.(element(href)) !== false,
    );
  for (const href of [
    "https://a.example",
    "http://a.example",
    "mailto:a@b.example",
    "/acme/spaces/x",
    "#retries",
  ]) {
    assert.ok(isSafePageLink(href), href);
    assert.doesNotThrow(() => linked(href));
    assert.ok(pasted(href), href);
  }
  for (const href of [
    "ftp://a.example",
    "tel:123",
    "javascript:alert(1)",
    "//a.example",
    "a.example",
  ]) {
    assert.ok(!isSafePageLink(href), href);
    assert.throws(() => linked(href), PageDocumentError);
    assert.ok(!pasted(href), href);
    assert.doesNotMatch(
      JSON.stringify(markdownToDocument(`[x](${href})`)),
      /"link"/,
    );
  }
});
void test("canonical attrs and hashes ignore input property order and include title and schema", () => {
  const a = doc(p("a"));
  const b = { content: a.content, type: "doc" };
  assert.equal(documentHash("Title", a), documentHash("Title", b));
  assert.notEqual(documentHash("Title", a), documentHash("Other", a));
  assert.equal(documentHash("Title", a).length, 64);
});
void test("deterministic GFM includes tables, tasks, references and escaped text", () => {
  const d = doc(
    {
      type: "heading",
      attrs: { id: "h", level: 2 },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "paragraph",
      attrs: { id: "refs" },
      content: [
        { type: "workItemRef", attrs: { workItemId: "wi", key: "PAY-142" } },
        { type: "pageRef", attrs: { pageId: "pg" } },
      ],
    },
    {
      type: "taskList",
      attrs: { id: "tasks" },
      content: [
        {
          type: "taskItem",
          attrs: { id: "task", checked: true },
          content: [p("tp", "done")],
        },
      ],
    },
    table("cell"),
  );
  const markdown = documentToMarkdown(d);
  assert.match(markdown, /## Title/);
  assert.match(markdown, /\[PAY-142\]\(item:wi\)\[Linked page\]\(page:pg\)/);
  assert.match(markdown, /- \[x\] done/);
  assert.match(markdown, /\| --- \|/);
  assert.equal(markdown, documentToMarkdown(d));
});
void test("page Markdown keeps reference identity through export and import", () => {
  const d = doc({
    type: "paragraph",
    attrs: { id: "refs" },
    content: [
      { type: "text", text: "See " },
      { type: "workItemRef", attrs: { workItemId: "item-1", key: "PAY-2" } },
      { type: "text", text: ", " },
      { type: "pageRef", attrs: { pageId: "page-1" } },
      { type: "text", text: " and " },
      {
        type: "pageRef",
        attrs: { pageId: "page-2", commitId: "commit-9" },
      },
      { type: "text", text: " under " },
      {
        type: "decisionRef",
        attrs: { decisionId: "dec-1", label: "Retries reuse the ID" },
      },
    ],
  });
  const markdown = documentToMarkdown(d);
  assert.equal(
    markdown,
    "See [PAY-2](item:item-1), [Linked page](page:page-1) and [Linked page](page:page-2@commit-9) under [Retries reuse the ID](decision:dec-1)",
  );
  const back = markdownToDocument(markdown);
  const inline = back.content![0]!.content!.filter((n) => n.type !== "text");
  assert.deepEqual(
    inline.map((n) => [n.type, n.attrs]),
    [
      ["workItemRef", { workItemId: "item-1", key: "PAY-2" }],
      ["pageRef", { pageId: "page-1" }],
      ["pageRef", { pageId: "page-2", commitId: "commit-9" }],
      ["decisionRef", { decisionId: "dec-1", label: "Retries reuse the ID" }],
    ],
  );
  // A second export is identical: identity survives any number of trips.
  assert.equal(documentToMarkdown(back), markdown);
  // The older page form is still read.
  const legacy = markdownToDocument("Read [[page:page-3]] first");
  assert.deepEqual(
    legacy.content![0]!.content!.find((n) => n.type === "pageRef")!.attrs,
    { pageId: "page-3" },
  );
});
function table(text: string): PageNode {
  return {
    type: "table",
    attrs: { id: "table" },
    content: [
      {
        type: "tableRow",
        attrs: { id: "row" },
        content: [
          {
            type: "tableCell",
            attrs: { id: "cell" },
            content: [p("cp", text)],
          },
        ],
      },
    ],
  };
}
void test("Yjs default field exactly round trips canonical rich documents", () => {
  const rich = doc(
    list(true),
    table("a"),
    {
      type: "paragraph",
      attrs: { id: "refs" },
      content: [
        { type: "workItemRef", attrs: { key: "PAY-1", workItemId: "work" } },
        {
          type: "text",
          text: "bold",
          marks: [
            { type: "bold" },
            { type: "link", attrs: { href: "https://example.com" } },
          ],
        },
        { type: "pageRef", attrs: { pageId: "page" } },
        { type: "hardBreak" },
      ],
    },
    {
      type: "image",
      attrs: { id: "img", src: "/api/files/id", alt: "a", title: "t" },
    },
  );
  assert.deepEqual(draftStateToDocument(documentToDraftState(rich)), rich);
  assert.deepEqual(
    draftStateToDocument(documentToDraftState(emptyDocument())).type,
    "doc",
  );
  assert.throws(
    () => draftStateToDocument(new Uint8Array([255])),
    PageDocumentError,
  );
});
void test("one-sided, identical and independent block edits merge cleanly", () => {
  const b = doc(p("a"), p("b"));
  const o = doc(p("a", "edit"), p("b"));
  assert.deepEqual(merge(b, o, b), { status: "clean", document: o });
  assert.deepEqual(merge(b, o, o), { status: "clean", document: o });
  assert.deepEqual(
    merge(b, o, doc(p("a"), p("b", "other"))).document,
    doc(p("a", "edit"), p("b", "other")),
  );
});
void test("same block edits conflict locally while other edits auto merge", () => {
  const b = doc(p("a"), p("b"));
  const r = conflicts(
    merge(
      b,
      doc(p("a", "ours"), p("b")),
      doc(p("a", "theirs"), p("b", "independent")),
    ),
  );
  assert.equal(r.conflicts[0]!.blockId, "a");
  assert.match(r.conflicts[0]!.theirs.markdown, /theirs/);
  assert.equal(r.document.content![1]!.content![0]!.text, "independent");
  assert.deepEqual(
    resolveMerge(r, { [r.conflicts[0]!.id]: "theirs" }),
    doc(p("a", "theirs"), p("b", "independent")),
  );
  assert.equal(
    r.conflicts[0]!.id,
    conflicts(
      merge(
        b,
        doc(p("a", "ours"), p("b")),
        doc(p("a", "theirs"), p("b", "independent")),
      ),
    ).conflicts[0]!.id,
  );
});
void test("move vs edit preserves location and content; move/delete and competing moves conflict", () => {
  const b = doc(p("a"), p("b"), p("c"));
  const moved = doc(p("b"), p("a"), p("c"));
  assert.deepEqual(
    merge(b, moved, doc(p("a", "edited"), p("b"), p("c"))).document,
    doc(p("b"), p("a", "edited"), p("c")),
  );
  conflicts(merge(b, moved, doc(p("b"), p("c"))));
  conflicts(merge(b, moved, doc(p("a"), p("c"), p("b"))));
});
void test("split and join overlap preserve complete alternatives", () => {
  const b = doc(p("a", "hello world"), p("b", "tail"));
  const split = doc(p("a", "hello"), p("new", "world"), p("b", "tail"));
  const r = conflicts(merge(b, split, doc(p("a", "other"), p("b", "tail"))));
  assert.equal(r.conflicts[0]!.ours.json.length, 2);
  assert.deepEqual(
    resolveMerge(r, { [r.conflicts[0]!.id]: "theirs" }),
    doc(p("a", "other"), p("b", "tail")),
  );
  const joined = doc(p("a", "hello world tail"));
  conflicts(merge(b, joined, doc(p("a", "hello world"), p("b", "changed"))));
});
void test("list nesting conflicts at whole list, independent text edits within list merge", () => {
  const r = conflicts(
    merge(doc(list()), doc(list(true)), doc(list(false, "other"))),
  );
  assert.equal(r.conflicts[0]!.blockId, "list");
  assert.deepEqual(
    resolveMerge(r, { [r.conflicts[0]!.id]: "theirs" }),
    doc(list(false, "other")),
  );
});
void test("table edits on both sides conflict at table", () => {
  const r = conflicts(
    merge(doc(table("base")), doc(table("ours")), doc(table("theirs"))),
  );
  assert.equal(r.conflicts[0]!.blockId, "table");
});
void test("ambiguous missing or pasted IDs widen conflicts; both regenerates duplicate IDs", () => {
  const r = conflicts(
    merge(doc(p("a")), doc(p("a", "ours")), doc(p("a", "theirs"))),
  );
  const resolved = resolveMerge(r, { [r.conflicts[0]!.id]: "both" });
  assert.equal(resolved.content!.length, 2);
  assert.notEqual(
    resolved.content![0]!.attrs!.id,
    resolved.content![1]!.attrs!.id,
  );
  const raw: PageNode = { type: "doc", content: [{ type: "paragraph" }] };
  assert.equal(
    conflicts(merge(raw, { type: "doc", content: [p("x")] }, doc(p("y"))))
      .conflicts[0]!.path.length,
    0,
  );
  const pasted: PageNode = { type: "doc", content: [p("a"), p("a")] };
  assert.equal(
    conflicts(merge(doc(p("a")), pasted, doc(p("a", "edit")))).conflicts[0]!
      .path.length,
    0,
  );
  assert.throws(() => resolveMerge(r, {}), PageDocumentError);
  assert.deepEqual(
    resolveMerge(r, {
      [r.conflicts[0]!.id]: { manual: p("manual", "resolved") },
    }),
    doc(p("manual", "resolved")),
  );
});
void test("large ambiguous changes produce one document conflict", () => {
  const b = doc(...Array.from({ length: 1001 }, (_, i) => p(String(i))));
  const o = structuredClone(b),
    t = structuredClone(b);
  o.content![0] = p("0", "ours");
  t.content![1] = p("1", "theirs");
  const r = conflicts(merge(b, o, t));
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(r.conflicts[0]!.path, []);
});
void test("diff records adds, removals, edits and moves without treating insertion as move", () => {
  const changes = diffDocuments(
    doc(p("a"), p("b"), p("gone")),
    doc(p("new"), p("a", "edited"), p("b")),
  );
  assert.deepEqual(
    changes.map((c) => c.kind),
    ["added", "changed", "unchanged", "removed"],
  );
  const moved = diffDocuments(doc(p("a"), p("b")), doc(p("b", "edit"), p("a")));
  assert.ok(moved.some((c) => c.kind === "moved"));
  assert.ok(
    moved.find((c) => c.blockId === "b")!.afterMarkdown!.includes("edit"),
  );
});
void test("ordered lists and every schema block remain canonical across repeated validation", () => {
  const d = doc(
    {
      type: "orderedList",
      attrs: { id: "ol", start: 3 },
      content: [
        { type: "listItem", attrs: { id: "li" }, content: [p("text")] },
      ],
    },
    { type: "blockquote", attrs: { id: "quote" }, content: [p("qp")] },
    {
      type: "codeBlock",
      attrs: { id: "code", language: "ts" },
      content: [{ type: "text", text: "const a = 1;" }],
    },
    { type: "horizontalRule", attrs: { id: "rule" } },
  );
  assert.deepEqual(canon(d), d);
  assert.deepEqual(draftStateToDocument(documentToDraftState(d)), d);
  assert.match(documentToMarkdown(d), /3\. text/);
});
void test("independent list text edits merge at the paragraphs", () => {
  const l = list();
  l.content!.push({
    type: "listItem",
    attrs: { id: "item2" },
    content: [p("p2")],
  });
  const b = doc(l),
    o = structuredClone(b),
    t = structuredClone(b);
  o.content![0]!.content![0]!.content![0] = p("lp", "ours");
  t.content![0]!.content![1]!.content![0] = p("p2", "theirs");
  const r = merge(b, o, t);
  assert.equal(r.status, "clean");
  assert.match(documentToMarkdown(r.document), /ours/);
  assert.match(documentToMarkdown(r.document), /theirs/);
});
void test("resolving several conflicts survives length-changing replacements", () => {
  const b = doc(p("a"), p("b")),
    o = doc(p("a", "oa"), p("b", "ob")),
    t = doc(p("a", "ta"), p("b", "tb"));
  const r = conflicts(merge(b, o, t));
  assert.equal(r.conflicts.length, 2);
  const resolved = resolveMerge(
    r,
    Object.fromEntries(r.conflicts.map((c) => [c.id, "both" as const])),
  );
  assert.deepEqual(
    resolved.content!.map((n) => n.content![0]!.text),
    ["oa", "ta", "ob", "tb"],
  );
  assert.equal(new Set(resolved.content!.map((n) => n.attrs!.id)).size, 4);
});
void test("independent insertions and deletions combine without losing text", () => {
  const b = doc(p("a"), p("b"), p("c"));
  const r = merge(
    b,
    doc(p("a"), p("b"), p("new"), p("c")),
    doc(p("b"), p("c")),
  );
  assert.equal(r.status, "clean");
  assert.deepEqual(r.document, doc(p("b"), p("new"), p("c")));
});
void test("ambiguous moves widen only to their stable heading section", () => {
  const h = (id: string): PageNode => ({
    type: "heading",
    attrs: { id, level: 1 },
    content: [{ type: "text", text: id }],
  });
  const b = doc(h("first"), p("a"), p("b"), p("c"), h("second"), p("tail"));
  const o = doc(h("first"), p("b"), p("a"), p("c"), h("second"), p("tail"));
  const t = doc(
    h("first"),
    p("a"),
    p("c"),
    p("b"),
    h("second"),
    p("tail", "auto merged"),
  );
  const r = conflicts(merge(b, o, t));
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0]!.blockId, "first");
  assert.deepEqual(r.conflicts[0]!.path, [0]);
  const resolved = resolveMerge(r, { [r.conflicts[0]!.id]: "theirs" });
  assert.deepEqual(resolved, t);
});
void test("moves across heading sections combine with edits to the moved block", () => {
  const h = (id: string): PageNode => ({
    type: "heading",
    attrs: { id, level: 1 },
  });
  const b = doc(h("one"), p("a"), h("two"), p("b"));
  const o = doc(h("one"), h("two"), p("b"), p("a"));
  const t = doc(h("one"), p("a", "edited"), h("two"), p("b"));
  assert.deepEqual(merge(b, o, t), {
    status: "clean",
    document: doc(h("one"), h("two"), p("b"), p("a", "edited")),
  });
});
