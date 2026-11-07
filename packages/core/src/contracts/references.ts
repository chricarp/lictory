// References between Lictory artifacts in Markdown and in page documents.
//
// Specifications, discussions and the Markdown derived from pages write a
// reference as an ordinary Markdown link with a typed target, like mentions
// (`@[ada](mention:USER_ID)`):
//
//   [PAY-142](item:WORK_ITEM_ID)                    a work item
//   [Payments service](page:PAGE_ID)                a page, latest published
//   [Payments service](page:PAGE_ID@COMMIT_ID)      a page at one exact commit
//   [Retries reuse the ID](decision:DECISION_ID)    a recorded decision
//
// The label is what a reader without access (or any other Markdown consumer,
// such as an external delivery tool) sees; the target is the stable identity,
// so renames and moves never break a reference. Readers resolve the target
// against what they may read now and never reveal more than the label. The
// older page form `[[page:PAGE_ID]]` is still read.

export type ReferenceTarget =
  | { kind: "item"; id: string }
  | { kind: "page"; id: string; commitId?: string }
  | { kind: "decision"; id: string };

export type Reference = ReferenceTarget & { label: string };

const idPattern = "[A-Za-z0-9_-]{1,160}";
const targetPattern = new RegExp(
  `^(item|page|decision):(${idPattern})(?:@(${idPattern}))?$`,
);
// A Markdown link whose target is one of the reference kinds. Labels may not
// contain brackets or line breaks (the formatter escapes them away).
const linkPattern = new RegExp(
  `(?<!@)\\[([^\\[\\]\\n]{0,300})\\]\\(((?:item|page|decision):${idPattern}(?:@${idPattern})?)\\)`,
  "g",
);
const legacyPagePattern = new RegExp(`\\[\\[page:(${idPattern})\\]\\]`, "g");

/** Parses a link target such as `page:ID@COMMIT`; undefined for other links. */
export function parseReferenceTarget(
  href: string | null | undefined,
): ReferenceTarget | undefined {
  const match = href ? targetPattern.exec(href) : null;
  if (!match) return undefined;
  const [, kind, id, commitId] = match;
  if (kind === "page")
    return commitId ? { kind, id: id!, commitId } : { kind, id: id! };
  if (commitId) return undefined;
  return { kind: kind as "item" | "decision", id: id! };
}

/** The link target of a reference: `item:ID`, `page:ID[@COMMIT]`, `decision:ID`. */
export function referenceHref(target: ReferenceTarget): string {
  return target.kind === "page" && target.commitId
    ? `page:${target.id}@${target.commitId}`
    : `${target.kind}:${target.id}`;
}

function escapeLabel(label: string): string {
  const clean = label
    .replace(/[[\]\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return clean || "reference";
}

/** A reference written as Markdown: `[label](kind:ID)`. */
export function formatReference(
  target: ReferenceTarget,
  label: string,
): string {
  return `[${escapeLabel(label)}](${referenceHref(target)})`;
}

/**
 * Every reference in a Markdown text, in order of appearance, including the
 * legacy `[[page:ID]]` form. Code spans and fenced code blocks are skipped, so
 * an example in a code block never counts as a reference.
 */
export function referencesInMarkdown(markdown: string): Reference[] {
  const text = withoutCode(markdown);
  const found: { at: number; reference: Reference }[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const target = parseReferenceTarget(match[2]);
    if (target)
      found.push({
        at: match.index,
        reference: { ...target, label: match[1]! },
      });
  }
  for (const match of text.matchAll(legacyPagePattern))
    found.push({
      at: match.index,
      reference: { kind: "page", id: match[1]!, label: match[1]! },
    });
  return found.sort((a, b) => a.at - b.at).map((f) => f.reference);
}

// Code replaced by spaces of the same length, so offsets stay meaningful.
function withoutCode(markdown: string): string {
  return markdown
    .replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(\n\2[^\n]*(?=\n|$)|$)/g, (m) =>
      m.replace(/[^\n]/g, " "),
    )
    .replace(/`[^`\n]+`/g, (m) => " ".repeat(m.length));
}

type DocNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

/** A reference found in a page document, with the top-level block holding it. */
export type DocumentReference = ReferenceTarget & { blockId: string | null };

/**
 * Every work item, page and decision reference in a canonical page document,
 * with the id of the top-level block that contains it (null when the block
 * has no id). Duplicates within one block are reported once.
 */
export function referencesInDocument(doc: unknown): DocumentReference[] {
  const out: DocumentReference[] = [];
  const seen = new Set<string>();
  const add = (reference: DocumentReference) => {
    const key = `${reference.blockId}|${referenceHref(reference)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(reference);
  };
  const visit = (node: DocNode, blockId: string | null) => {
    const a = node.attrs ?? {};
    if (node.type === "workItemRef" && typeof a.workItemId === "string")
      add({ kind: "item", id: a.workItemId, blockId });
    else if (node.type === "pageRef" && typeof a.pageId === "string")
      add({
        kind: "page",
        id: a.pageId,
        ...(typeof a.commitId === "string" && a.commitId
          ? { commitId: a.commitId }
          : {}),
        blockId,
      });
    else if (node.type === "decisionRef" && typeof a.decisionId === "string")
      add({ kind: "decision", id: a.decisionId, blockId });
    for (const child of node.content ?? []) visit(child, blockId);
  };
  const root = (doc ?? {}) as DocNode;
  for (const block of root.content ?? [])
    visit(block, typeof block.attrs?.id === "string" ? block.attrs.id : null);
  return out;
}
