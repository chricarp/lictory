import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { referencesInMarkdown } from "@lictory/core/contracts/references";
import { sectionContent } from "@lictory/core/contracts/readiness";
import { mentionedUserIds } from "@lictory/core/notifications/mentions";
import {
  parseMarkdown,
  serializeMarkdown,
  type MarkdownJSON,
} from "@lictory/core/editor/markdown";

// The rich editor stores Markdown. These tests prove that it never changes
// text nobody edited, that what it writes reads back as the same document,
// and that the facts other parts of Lictory read from Markdown (readiness
// sections, references, mentions) survive.

const root = new URL("../../../../", import.meta.url).pathname;

// Representative specifications: the shapes seeded by tests and scripts,
// the editor's own template, onboarding and AI drafts, and the constructs a
// specification may contain.
const specifications: Record<string, string> = {
  template:
    "# Intent\n\nWhy this matters and for whom.\n\n## Behavior\n\n…\n\n## Acceptance criteria\n\n- [ ] …",
  loadTest:
    "## Behaviour\n\nWhen the provider times out, the payment is retried with the original transaction id.\n\n## Acceptance criteria\n\n- Retries reuse the id\n- Customers are charged once\n",
  sync: "# Behavior\n\nPayouts run hourly.",
  refunds: `# Refund a settled payment

Support agents refund settled card payments from the payment page. Refunds go
back to the original card; partial refunds are allowed up to the captured
amount.

## Behavior

1. The agent opens a settled payment and chooses **Refund**.
2. Lictory asks for the amount (default: the full captured amount) and a reason.
3. The refund is sent to the provider with an idempotency key derived from
   the payment ID and the refund sequence number.
   - A retry reuses the key, so the customer is never refunded twice.
   - The key is \`refund:{paymentId}:{sequence}\`.
4. The payment shows *Refund pending* until the provider confirms.

## Failure behavior

> If the provider does not answer within 30 seconds, the refund stays
> pending and is retried with the same key. After 3 failed retries the
> agent sees an error and the refund is marked failed.

| Case | Result | Retries |
| :--- | :----: | ------: |
| Timeout | pending | 3 |
| Declined | failed | 0 |
| \`5xx\` | pending | 3 |

## Acceptance criteria

- [ ] A partial refund of 10.00 on a 25.00 payment leaves 15.00 refundable
- [x] Refunding more than the refundable amount is refused
- [ ] Two concurrent refunds never exceed the captured amount

## API

\`\`\`ts title="refund.ts"
await payments.refund(paymentId, { amount: 1000, reason: "duplicate" });
\`\`\`

See [the provider docs](https://example.com/refunds "Refunds") and ![flow](/api/files/0b3c-flow).
Owner: @[ada](mention:user-ada), reviewed with @[ben](mention:user-ben).
Depends on [PAY-2](item:item-pay-2), follows [Refund runbook](page:page-runbook@commit-7) and
[Retries reuse the ID](decision:dec-retry). Legacy link: [[page:page-old]].

---

Line one\\
line two after a hard break.
`,
  edges: `Setext heading
==============

Second level
------------

    indented code block

* star bullets
* with *underscored* and __strong__ text

+ plus bullets

1) parenthesis
2) ordered

Text with snake_case, 2 * 3, a_b_c, <kbd>Ctrl</kbd>, &amp; and &copy; entities.

<!-- Guidance for writers: describe the failure behavior. -->

<details>
<summary>More</summary>

Hidden text.

</details>

A footnote reference[^1] and a [reference link][docs].

[^1]: The footnote.

[docs]: https://example.com/docs

- [ ] a task
- a plain item in the same list

Autolinks: <https://example.com> and https://example.org/path.

**Bold with [a link](https://example.com)** and [\`code in a link\`](https://example.com).

Escaped \\*stars\\* and \\# not a heading.

~~struck~~ text

1. loose

2. list

> quote with
> - a list
>
> \`\`\`
> code
> \`\`\`

\`\`\`\`md
\`\`\`
nested fence
\`\`\`
\`\`\`\`
`,
};

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

// Every document in the repository as well: long, varied Markdown.
const documents: Record<string, string> = Object.fromEntries(
  [
    ...markdownFiles(join(root, "docs")),
    ...markdownFiles(join(root, "apps/docs/content")),
  ].map((path) => [relative(root, path), readFileSync(path, "utf8")]),
);

const fixtures = { ...specifications, ...documents };

const atxHeadings = (markdown: string) =>
  [
    ...markdown
      .replace(/^(```|~~~)[\s\S]*?^\1/gm, "")
      .matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm),
  ].map((m) => m[1]!);

void test("opening and writing back unchanged Markdown reproduces it byte for byte", () => {
  for (const [name, markdown] of Object.entries(fixtures)) {
    const source = parseMarkdown(markdown);
    assert.equal(serializeMarkdown(source.doc, source), markdown, name);
  }
  for (const empty of ["", "\n", "  \n\n"]) {
    const source = parseMarkdown(empty);
    assert.equal(serializeMarkdown(source.doc, source), empty);
  }
});

void test("freshly written Markdown reads back as the same document and is a fixpoint", () => {
  for (const [name, markdown] of Object.entries(fixtures)) {
    const { doc } = parseMarkdown(markdown);
    const fresh = serializeMarkdown(doc);
    assert.deepEqual(parseMarkdown(fresh).doc, doc, name);
    assert.equal(serializeMarkdown(parseMarkdown(fresh).doc), fresh, name);
  }
});

void test("readiness sections, references and mentions survive a fresh write", () => {
  for (const [name, markdown] of Object.entries(fixtures)) {
    const fresh = serializeMarkdown(parseMarkdown(markdown).doc);
    for (const heading of atxHeadings(markdown)) {
      const before = sectionContent(markdown, heading);
      const after = sectionContent(fresh, heading);
      assert.ok(after !== undefined, `${name}: section ${heading}`);
      assert.equal(
        Boolean(before?.trim()),
        Boolean(after?.trim()),
        `${name}: section ${heading} keeps its content`,
      );
    }
    // Identity survives; the older page form gains a neutral label.
    const identity = (markdown: string) =>
      referencesInMarkdown(markdown).map((r) =>
        r.kind === "page" ? { ...r, label: "" } : r,
      );
    assert.deepEqual(identity(fresh), identity(markdown), name);
    assert.deepEqual(mentionedUserIds(fresh), mentionedUserIds(markdown), name);
  }
});

void test("the editor model holds what specifications use", () => {
  const { doc } = parseMarkdown(specifications.refunds!);
  const types = new Set<string>();
  const marks = new Set<string>();
  const visit = (node: MarkdownJSON) => {
    types.add(node.type);
    node.marks?.forEach((m) => marks.add(m.type));
    node.content?.forEach(visit);
  };
  visit(doc);
  for (const type of [
    "heading",
    "orderedList",
    "bulletList",
    "taskList",
    "blockquote",
    "table",
    "tableHeader",
    "codeBlock",
    "image",
    "mention",
    "workItemRef",
    "pageRef",
    "decisionRef",
    "hardBreak",
    "horizontalRule",
  ])
    assert.ok(types.has(type), type);
  for (const mark of ["bold", "italic", "code", "link"])
    assert.ok(marks.has(mark), mark);
  assert.ok(!types.has("rawBlock"));
  const refs = doc
    .content!.flatMap((b) => b.content ?? [])
    .filter((n) =>
      ["workItemRef", "pageRef", "decisionRef", "mention"].includes(n.type),
    );
  assert.deepEqual(JSON.parse(JSON.stringify(refs.map((n) => n.attrs))), [
    { id: "user-ada", label: "ada" },
    { id: "user-ben", label: "ben" },
    { workItemId: "item-pay-2", key: "PAY-2" },
    { pageId: "page-runbook", commitId: "commit-7", label: "Refund runbook" },
    { decisionId: "dec-retry", label: "Retries reuse the ID" },
    // The older page form is read as a page reference.
    { pageId: "page-old", commitId: null, label: "Linked page" },
  ]);
  const table = doc.content!.find((b) => b.type === "table")!;
  assert.deepEqual(
    table.content![0]!.content!.map((c) => c.attrs?.align ?? null),
    ["left", "center", "right"],
  );
  const code = doc.content!.find((b) => b.type === "codeBlock")!;
  assert.deepEqual(
    { ...code.attrs },
    { language: "ts", meta: 'title="refund.ts"' },
  );
});

void test("what the editor cannot represent is kept verbatim", () => {
  const source = parseMarkdown(specifications.edges!);
  const raw = (source.doc.content ?? [])
    .filter((b) => b.type === "rawBlock")
    .map((b) => String(b.attrs?.source));
  assert.ok(
    raw.includes(
      "<!-- Guidance for writers: describe the failure behavior. -->",
    ),
  );
  assert.ok(raw.includes("[^1]: The footnote."));
  assert.ok(raw.includes("[docs]: https://example.com/docs"));
  assert.ok(raw.some((r) => r.startsWith("- [ ] a task\n- a plain item")));
  const inline = JSON.stringify(source.doc);
  for (const verbatim of ["<kbd>", "[^1]", "[reference link][docs]"])
    assert.ok(inline.includes(JSON.stringify(verbatim).slice(1, -1)), verbatim);
});

void test("an edit rewrites only the block it touches", () => {
  const markdown = specifications.refunds!;
  const source = parseMarkdown(markdown);
  const doc = structuredClone(source.doc);
  const intro = doc.content![1]!;
  intro.content = [
    { type: "text", text: "Agents refund settled card payments." },
  ];
  const written = serializeMarkdown(doc, source);
  const before = markdown.split("\n");
  const after = written.split("\n");
  // The three lines of the edited paragraph became one; everything else is
  // the same text in the same place.
  assert.deepEqual(after.slice(0, 2), before.slice(0, 2));
  assert.equal(after[2], "Agents refund settled card payments.");
  assert.deepEqual(after.slice(3), before.slice(5));
});

void test("adding blocks keeps neighbours apart and unterminated fences closed", () => {
  const source = parseMarkdown("- a\n- b\n\n```\nopen fence");
  const doc = structuredClone(source.doc);
  // A new list right after the first one, and a paragraph after the fence.
  doc.content!.splice(1, 0, {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "c" }] },
        ],
      },
    ],
  });
  doc.content!.push({
    type: "paragraph",
    content: [{ type: "text", text: "after" }],
  });
  const written = serializeMarkdown(doc, source);
  assert.equal(written, "- a\n- b\n\n* c\n\n```\nopen fence\n```\n\nafter");
  const back = parseMarkdown(written).doc.content!.map((b) => b.type);
  assert.deepEqual(back, [
    "bulletList",
    "bulletList",
    "codeBlock",
    "paragraph",
  ]);

  const comment = parseMarkdown("<!-- unclosed");
  const next = structuredClone(comment.doc);
  next.content!.push({
    type: "paragraph",
    content: [{ type: "text", text: "visible" }],
  });
  const out = serializeMarkdown(next, comment);
  assert.equal(out, "<!-- unclosed\n-->\n\nvisible");
  assert.equal(parseMarkdown(out).doc.content!.at(-1)!.type, "paragraph");
});

void test("text that looks like Markdown stays text", () => {
  const doc: MarkdownJSON = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "# not a heading\n- not a list\n1. not ordered\n> not a quote\n---\n| a | b |\n| - | - |\n*stars* _under_ [brackets] <tag> `ticks` ~~tilde~~ a\\b snake_case",
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold ", marks: [{ type: "bold" }] },
          { type: "text", text: "then plain" },
        ],
      },
    ],
  };
  const written = serializeMarkdown(doc);
  const back = parseMarkdown(written).doc;
  assert.deepEqual(
    back.content!.map((b) => b.type),
    ["paragraph", "paragraph"],
  );
  assert.equal(
    back.content![0]!.content![0]!.text,
    doc.content![0]!.content![0]!.text,
  );
  assert.match(written, /\*\*bold\*\* then plain/);
  assert.match(written, /snake_case/);
});
