import type { Nodes, PhrasingContent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Schema } from "@tiptap/pm/model";
import {
  formatReference,
  parseReferenceTarget,
} from "@lictory/core/contracts/references";
import { stableSerialize } from "@lictory/core/spaces/document/canonical";
import { markdownSchema } from "@lictory/core/editor/schema";

// Markdown ⇄ rich documents for everything Work stores as Markdown.
//
// Markdown is the stored format: revisions, diffs, readiness checks, AI
// patches and exports all read it. The rich editor must therefore never
// change text nobody edited. Three rules make that hold:
//
// 1. Every top-level block remembers the exact Markdown it was read from.
//    Writing a document back reuses that text for every block whose content
//    is unchanged (the same document node), with the original separators
//    between neighbours, so opening and saving reproduces the input byte for
//    byte and an edit changes only the blocks it touched.
// 2. Blocks that are written fresh use one deterministic GFM form that reads
//    back as the same document (proven by the round-trip suite). The only
//    normalizations are harmless whitespace forms: blank lines between
//    blocks, list and quote indentation, leading spaces at the start of a
//    line and trailing spaces before a soft line break (which Markdown
//    ignores), ATX headings, fenced code, `-`/`1.` list markers, `*` and `**`
//    emphasis, `\` hard breaks, and table cells padded to one width.
// 3. What the editor cannot represent (raw HTML, footnotes, link reference
//    definitions, lists mixing tasks and plain items, code inside a link…)
//    is kept verbatim: a top-level block as an uneditable `rawBlock`, inline
//    syntax as `rawInline`. Nothing is dropped.

export type MarkdownJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: MarkdownJSON[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

type SourceBlock = {
  // The block as the schema normalizes it, serialized stably.
  key: string;
  source: string;
  start: number;
  end: number;
  terminated?: boolean;
};

/** A Markdown text as a document, with what is needed to write it back. */
export type MarkdownSource = {
  markdown: string;
  doc: MarkdownJSON;
  blocks: SourceBlock[];
  leading: string;
  trailing: string;
};

class Unrepresentable extends Error {}

const str = (value: unknown) => (typeof value === "string" ? value : "");

const parse = (markdown: string) =>
  fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

/** Stable identity of one top-level block, compared to decide reuse. */
export function blockKey(node: MarkdownJSON): string {
  return stableSerialize(node);
}

/**
 * Reads Markdown into a document of `schema` (the shared Markdown schema by
 * default; the browser passes its editor's, which has the same nodes).
 */
export function parseMarkdown(
  markdown: string,
  schema: Schema = markdownSchema,
): MarkdownSource {
  const tree = parse(markdown);
  const blocks: SourceBlock[] = [];
  const content: MarkdownJSON[] = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    const source = markdown.slice(start, end);
    let json: MarkdownJSON;
    try {
      const converted = block(node, { markdown, depth: 0 });
      const checked = schema.nodeFromJSON(converted);
      checked.check();
      json = checked.toJSON() as MarkdownJSON;
    } catch {
      json = schema
        .nodeFromJSON({ type: "rawBlock", attrs: { source } })
        .toJSON() as MarkdownJSON;
    }
    content.push(json);
    blocks.push({ key: blockKey(json), source, start, end });
  }
  const doc = schema
    .nodeFromJSON({
      type: "doc",
      content: content.length ? content : [{ type: "paragraph" }],
    })
    .toJSON() as MarkdownJSON;
  const first = blocks[0];
  const last = blocks.at(-1);
  return {
    markdown,
    doc,
    blocks,
    leading: first ? markdown.slice(0, first.start) : "",
    trailing: last ? markdown.slice(last.end) : "",
  };
}

/** One top-level block as the serializer sees it. */
export type TopLevelBlock = { key: string; json: () => MarkdownJSON };

/**
 * Writes a document back as Markdown. With the `source` it was read from,
 * unchanged blocks keep their exact text (see the rules above).
 */
export function serializeMarkdown(
  doc: MarkdownJSON,
  source?: MarkdownSource,
): string {
  return serializeBlocks(
    (doc.content ?? []).map((node) => ({
      key: blockKey(node),
      json: () => node,
    })),
    source,
    (node, hint) => renderBlock(node, hint),
  );
}

type ListHint = { bullet: "-" | "*"; delimiter: "." | ")" };
const defaultHint: ListHint = { bullet: "-", delimiter: "." };

/**
 * The top-level join behind `serializeMarkdown`, exposed so the editor can
 * cache keys and rendered blocks per document node.
 */
export function serializeBlocks(
  children: readonly TopLevelBlock[],
  source: MarkdownSource | undefined,
  render: (node: MarkdownJSON, hint: ListHint) => string,
): string {
  const original = source?.blocks ?? [];
  // Unchanged as a whole: the input, byte for byte.
  if (
    source &&
    (children.length === original.length ||
      (original.length === 0 && children.length === 1)) &&
    (original.length === 0
      ? isEmptyParagraph(children[0]!.json())
      : children.every((c, i) => c.key === original[i]!.key))
  )
    return source.markdown;

  const used = new Set<number>();
  const byKey = new Map<string, number[]>();
  original.forEach((b, i) =>
    byKey.set(b.key, [...(byKey.get(b.key) ?? []), i]),
  );
  type Part = { text: string; index: number | null; json: MarkdownJSON | null };
  const parts: Part[] = [];
  let previous = -1;
  for (const [position, child] of children.entries()) {
    let index: number | null = null;
    const next = previous + 1;
    if (original[next]?.key === child.key && !used.has(next)) index = next;
    else index = byKey.get(child.key)?.find((i) => !used.has(i)) ?? null;
    const last = position === children.length - 1;
    // Reuse never lets an unterminated construct (an unclosed fence, raw
    // HTML running to the end) swallow what now follows it: a fence is
    // written fresh, raw HTML gets its closing delimiter.
    if (index !== null && !last && !terminated(original[index]!)) {
      if (child.json().type === "rawBlock") {
        used.add(index);
        previous = index;
        parts.push({
          text: closeRawBlock(original[index]!.source),
          index,
          json: null,
        });
        continue;
      }
      index = null;
    }
    if (index !== null) {
      used.add(index);
      previous = index;
      parts.push({ text: original[index]!.source, index, json: null });
      continue;
    }
    const json = child.json();
    const hint = listHint(parts.at(-1), json);
    const text = render(json, hint);
    if (!text.trim() && json.type === "paragraph") continue;
    parts.push({ text, index: null, json });
  }
  if (!parts.length) return "";
  let out = parts[0]!.index === 0 && source ? source.leading : "";
  parts.forEach((part, i) => {
    const before = parts[i - 1];
    if (before)
      out +=
        source &&
        before.index !== null &&
        part.index !== null &&
        part.index === before.index + 1
          ? source.markdown.slice(
              original[before.index]!.end,
              original[part.index]!.start,
            )
          : "\n\n";
    out += part.text;
  });
  const lastPart = parts.at(-1)!;
  if (source) {
    if (lastPart.index === original.length - 1) out += source.trailing;
    else if (/\n\s*$/.test(source.trailing)) out += "\n";
  }
  return out;

  // A fresh list right after a list of the same kind uses the other marker,
  // or Markdown would read the two as one list.
  function listHint(before: Part | undefined, json: MarkdownJSON): ListHint {
    if (!before || !isList(json.type)) return defaultHint;
    if (before.json) {
      if (!isList(before.json.type)) return defaultHint;
      return siblingHint(before.json, json, defaultHint);
    }
    const marker = /^\s*([-*+]|\d{1,9}([.)]))/.exec(before.text);
    if (!marker) return defaultHint;
    return {
      bullet: marker[1] === "-" ? "*" : "-",
      delimiter: marker[2] === "." ? ")" : ".",
    };
  }
}

function isEmptyParagraph(node: MarkdownJSON) {
  return node.type === "paragraph" && !node.content?.length;
}

const isList = (type: string) =>
  type === "bulletList" || type === "orderedList" || type === "taskList";

function siblingHint(
  before: MarkdownJSON,
  json: MarkdownJSON,
  hint: ListHint,
): ListHint {
  const bulletish = (t: string) => t === "bulletList" || t === "taskList";
  if (bulletish(before.type) && bulletish(json.type))
    return { ...hint, bullet: hint.bullet === "-" ? "*" : "-" };
  if (before.type === "orderedList" && json.type === "orderedList")
    return { ...hint, delimiter: hint.delimiter === "." ? ")" : "." };
  return hint;
}

// Whether text after this block (a blank line, then more) starts a new
// block: unclosed fences and some raw HTML run to the end of the document.
// Only fences and HTML can; the answer is kept on the block.
function terminated(block: SourceBlock) {
  block.terminated ??=
    !/^\s*(`{3,}|~{3,}|<)/.test(block.source) ||
    parse(`${block.source}\n\nx`).children.length >= 2;
  return block.terminated;
}

// Closes raw HTML that would otherwise run to the end of the document.
function closeRawBlock(source: string) {
  const start = source.trimStart();
  if (start.startsWith("<!--")) return `${source}\n-->`;
  if (start.startsWith("<?")) return `${source}\n?>`;
  if (start.startsWith("<![CDATA[")) return `${source}\n]]>`;
  if (/^<![A-Za-z]/.test(start)) return `${source}\n>`;
  const tag = /^<(script|pre|style|textarea)/i.exec(start)?.[1];
  if (tag) return `${source}\n</${tag}>`;
  const fence = /^(`{3,}|~{3,})/.exec(start)?.[1];
  if (fence) return `${source}\n${fence}`;
  return source;
}

// ---------------------------------------------------------------- reading

type Context = { markdown: string; depth: number; heading?: boolean };

// The older page form `[[page:ID]]` in text becomes a page reference.
function legacyPageLinks(value: string, marks: Mark[]): MarkdownJSON[] {
  const out: MarkdownJSON[] = [];
  let last = 0;
  for (const match of value.matchAll(/\[\[page:([A-Za-z0-9_-]{1,160})\]\]/g)) {
    if (match.index > last)
      out.push(
        withMarks(
          { type: "text", text: value.slice(last, match.index) },
          marks,
        ),
      );
    out.push(
      withMarks(
        {
          type: "pageRef",
          attrs: { pageId: match[1]!, commitId: null, label: "Linked page" },
        },
        marks,
      ),
    );
    last = match.index + match[0].length;
  }
  if (value.length > last)
    out.push(withMarks({ type: "text", text: value.slice(last) }, marks));
  return out;
}

function slice(node: Nodes, context: Context) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) throw new Unrepresentable();
  return context.markdown.slice(start, end);
}

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join("");
  return "";
}

type Mark = NonNullable<MarkdownJSON["marks"]>[number];

function rawInline(node: Nodes, context: Context): MarkdownJSON {
  const source = slice(node, context);
  // Inside a list or quote a multi-line slice carries the container's
  // indentation; keep the whole top-level block verbatim instead.
  if (context.depth > 0 && source.includes("\n")) throw new Unrepresentable();
  return { type: "rawInline", attrs: { source } };
}

function withMarks(node: MarkdownJSON, marks: Mark[]): MarkdownJSON {
  return marks.length ? { ...node, marks } : node;
}

function inline(
  nodes: PhrasingContent[],
  context: Context,
  marks: Mark[] = [],
): MarkdownJSON[] {
  const out: MarkdownJSON[] = [];
  nodes.forEach((node, index) => {
    switch (node.type) {
      case "text": {
        let value = context.heading
          ? node.value.replace(/\n/g, " ")
          : node.value;
        // `@[label](mention:ID)`: the "@" belongs to the mention.
        const next = nodes[index + 1];
        if (
          value.endsWith("@") &&
          next?.type === "link" &&
          /^mention:[A-Za-z0-9_-]+$/.test(next.url)
        )
          value = value.slice(0, -1);
        out.push(...legacyPageLinks(value, marks));
        return;
      }
      case "strong":
        out.push(
          ...inline(node.children, context, [...marks, { type: "bold" }]),
        );
        return;
      case "emphasis":
        out.push(
          ...inline(node.children, context, [...marks, { type: "italic" }]),
        );
        return;
      case "delete":
        out.push(
          ...inline(node.children, context, [...marks, { type: "strike" }]),
        );
        return;
      case "inlineCode":
        if (!node.value) out.push(rawInline(node, context));
        else
          out.push({
            type: "text",
            text: node.value,
            marks: [...marks, { type: "code" }],
          });
        return;
      case "break":
        out.push(withMarks({ type: "hardBreak" }, marks));
        return;
      case "image":
        out.push(
          withMarks(
            {
              type: "image",
              attrs: {
                src: node.url,
                alt: node.alt ?? null,
                title: node.title ?? null,
              },
            },
            marks,
          ),
        );
        return;
      case "link": {
        const previous = nodes[index - 1];
        const mention = /^mention:([A-Za-z0-9_-]+)$/.exec(node.url);
        if (
          mention &&
          previous?.type === "text" &&
          previous.value.endsWith("@")
        ) {
          out.push(
            withMarks(
              {
                type: "mention",
                attrs: { id: mention[1]!, label: plain(node) },
              },
              marks,
            ),
          );
          return;
        }
        const target = parseReferenceTarget(node.url);
        const label = plain(node);
        if (target && node.children.every((c) => c.type === "text")) {
          const attrs =
            target.kind === "item"
              ? { workItemId: target.id, key: label }
              : target.kind === "page"
                ? {
                    pageId: target.id,
                    commitId: target.commitId ?? null,
                    label,
                  }
                : { decisionId: target.id, label };
          out.push(
            withMarks(
              {
                type:
                  target.kind === "item"
                    ? "workItemRef"
                    : target.kind === "page"
                      ? "pageRef"
                      : "decisionRef",
                attrs,
              },
              marks,
            ),
          );
          return;
        }
        const children = inline(node.children, context, [
          ...marks,
          {
            type: "link",
            attrs: { href: node.url, title: node.title ?? null },
          },
        ]);
        // A link without text has nothing a mark could sit on.
        if (!children.length || target) out.push(rawInline(node, context));
        else out.push(...children);
        return;
      }
      default:
        // Raw HTML, footnote references, reference-style links and images.
        out.push(withMarks(rawInline(node, context), marks));
    }
  });
  return out;
}

const paragraph = (content: MarkdownJSON[]): MarkdownJSON =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

function items(children: RootContent[], context: Context): MarkdownJSON[] {
  const content = children.map((c) => block(c, context));
  return content[0]?.type === "paragraph"
    ? content
    : [{ type: "paragraph" }, ...content];
}

function block(node: RootContent, context: Context): MarkdownJSON {
  const nested = { ...context, depth: context.depth + 1 };
  switch (node.type) {
    case "paragraph":
      return paragraph(inline(node.children, context));
    case "heading": {
      // A heading is one line; a multi-line setext heading reads the same.
      const content = inline(node.children, { ...context, heading: true });
      return {
        type: "heading",
        attrs: { level: node.depth },
        ...(content.length ? { content } : {}),
      };
    }
    case "thematicBreak":
      return { type: "horizontalRule" };
    case "blockquote":
      return {
        type: "blockquote",
        content: node.children.length
          ? node.children.map((c) => block(c, nested))
          : [{ type: "paragraph" }],
      };
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        ...(node.value
          ? { content: [{ type: "text", text: node.value }] }
          : {}),
      };
    case "list": {
      const checked = node.children.map((i) => typeof i.checked === "boolean");
      if (checked.some(Boolean) && !checked.every(Boolean))
        throw new Unrepresentable();
      const spread =
        node.spread === true || node.children.some((i) => i.spread);
      if (checked.length && checked.every(Boolean))
        return {
          type: "taskList",
          attrs: { spread },
          content: node.children.map((item) => ({
            type: "taskItem",
            attrs: { checked: item.checked === true },
            content: items(item.children, nested),
          })),
        };
      return {
        type: node.ordered ? "orderedList" : "bulletList",
        attrs: node.ordered ? { start: node.start ?? 1, spread } : { spread },
        content: node.children.map((item) => ({
          type: "listItem",
          content: items(item.children, nested),
        })),
      };
    }
    case "table": {
      const width = Math.max(0, ...node.children.map((r) => r.children.length));
      return {
        type: "table",
        content: node.children.map((row, r) => ({
          type: "tableRow",
          content: Array.from({ length: width }, (_, c) => {
            const cell = row.children[c];
            return {
              type: r === 0 ? "tableHeader" : "tableCell",
              attrs: { align: node.align?.[c] ?? null },
              content: [paragraph(cell ? inline(cell.children, nested) : [])],
            };
          }),
        })),
      };
    }
    default:
      // Raw HTML, definitions, footnotes: verbatim at the top level; inside
      // a container the whole top-level block is kept instead.
      if (context.depth > 0) throw new Unrepresentable();
      return { type: "rawBlock", attrs: { source: slice(node, context) } };
  }
}

// ---------------------------------------------------------------- writing

type Inline = { table: boolean };

function escapeText(text: string, inTable: boolean) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const before = text[i - 1] ?? "";
    const after = text[i + 1] ?? "";
    if ("\\`*[]~".includes(c)) out += `\\${c}`;
    else if (c === "_")
      out +=
        /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after) ? c : "\\_";
    else if (c === "<" && /[A-Za-z/!?]/.test(after)) out += "\\<";
    else if (c === "&" && /^&#?[A-Za-z0-9]+;/.test(text.slice(i))) out += "\\&";
    else if (c === "|" && inTable) out += "\\|";
    else out += c;
  }
  return out;
}

// Escapes what would start a block at the beginning of a line.
function escapeLineStart(line: string) {
  if (/^#{1,6}(\s|$)/.test(line)) return `\\${line}`;
  if (line.startsWith(">")) return `\\${line}`;
  if (/^[-+](\s|$)/.test(line)) return `\\${line}`;
  if (/^(=+|-+)\s*$/.test(line)) return `\\${line}`;
  if (
    /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) &&
    line.includes("|")
  )
    return `\\${line}`;
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line);
  if (ordered) return `${ordered[1]}\\${line.slice(ordered[1]!.length)}`;
  return line;
}

function destination(url: string) {
  return /[\s<>()]/.test(url) || !url
    ? `<${url.replace(/[<>\n]/g, (c) => encodeURIComponent(c))}>`
    : url;
}
function title(value: unknown) {
  return typeof value === "string" && value
    ? ` "${value.replace(/["\\]/g, "\\$&")}"`
    : "";
}

function codeSpan(text: string, inTable: boolean) {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map((s) => s.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad =
    /^`|`$/.test(text) ||
    (text.startsWith(" ") && text.endsWith(" ") && /[^ ]/.test(text))
      ? " "
      : "";
  const body = inTable ? text.replace(/\|/g, "\\|") : text;
  return `${fence}${pad}${body}${pad}${fence}`;
}

const markOrder = ["link", "bold", "italic", "strike"];
const emphasis: Record<string, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
};

function sameMark(a: Mark, b: Mark) {
  return (
    a.type === b.type && stableSerialize(a.attrs) === stableSerialize(b.attrs)
  );
}

// Emphasis cannot start or end with whitespace in Markdown: where an
// emphasis mark starts or ends on a text run, its whitespace moves outside.
function expelWhitespace(nodes: MarkdownJSON[]): MarkdownJSON[] {
  const has = (node: MarkdownJSON | undefined, mark: Mark) =>
    node?.marks?.some((m) => sameMark(m, mark)) ?? false;
  return nodes.flatMap((node, i) => {
    if (node.type !== "text" || !node.text || !node.marks?.length)
      return [node];
    if (node.marks.some((m) => m.type === "code")) return [node];
    const starts = node.marks.filter(
      (m) => m.type in emphasis && !has(nodes[i - 1], m),
    );
    const ends = node.marks.filter(
      (m) => m.type in emphasis && !has(nodes[i + 1], m),
    );
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text)!;
    const without = (text: string, drop: Mark[]): MarkdownJSON[] => {
      if (!text) return [];
      const kept = node.marks!.filter((m) => !drop.includes(m));
      return [withMarks({ type: "text", text }, kept)];
    };
    if (!match[2]) return without(node.text, [...starts, ...ends]);
    return [
      ...(starts.length ? without(match[1]!, starts) : without(match[1]!, [])),
      { ...node, text: match[2] },
      ...(ends.length ? without(match[3]!, ends) : without(match[3]!, [])),
    ];
  });
}

function renderInline(nodes: MarkdownJSON[] = [], options: Inline): string {
  let out = "";
  const stack: Mark[] = [];
  const close = (mark: Mark) => {
    if (mark.type === "link")
      out += `](${destination(str(mark.attrs?.href))}${title(mark.attrs?.title)})`;
    else out += emphasis[mark.type] ?? "";
  };
  const open = (mark: Mark) => {
    out += mark.type === "link" ? "[" : (emphasis[mark.type] ?? "");
  };
  for (const node of expelWhitespace(nodes)) {
    // Marks already open stay open (in their order) while still wanted;
    // new ones open inside them.
    const marks = (node.marks ?? []).filter((m) => markOrder.includes(m.type));
    let keep = 0;
    while (keep < stack.length && marks.some((m) => sameMark(m, stack[keep]!)))
      keep++;
    const wanted = [
      ...stack.slice(0, keep),
      ...marks
        .filter((m) => !stack.slice(0, keep).some((s) => sameMark(s, m)))
        .sort((a, b) => markOrder.indexOf(a.type) - markOrder.indexOf(b.type)),
    ];
    while (stack.length > keep) close(stack.pop()!);
    for (const mark of wanted.slice(keep)) {
      open(mark);
      stack.push(mark);
    }
    out += renderLeaf(node, options, out);
  }
  while (stack.length) close(stack.pop()!);
  return out;
}

function renderLeaf(
  node: MarkdownJSON,
  options: Inline,
  before: string,
): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "text": {
      const text = node.text ?? "";
      if (node.marks?.some((m) => m.type === "code"))
        return codeSpan(
          options.table ? text.replace(/\n/g, " ") : text,
          options.table,
        );
      if (options.table) return escapeText(text.replace(/\n/g, " "), true);
      return text
        .split("\n")
        .map((line, i) => {
          const atStart = i > 0 || before === "" || before.endsWith("\n");
          let escaped = escapeText(
            i > 0 ? line.replace(/^[ \t]+/, "") : line,
            false,
          );
          if (atStart)
            escaped = escapeLineStart(escaped.replace(/^[ \t]+/, ""));
          return escaped;
        })
        .map((line, i, all) =>
          i < all.length - 1 ? line.replace(/[ \t]+$/, "") : line,
        )
        .join("\n");
    }
    case "hardBreak":
      return options.table ? " " : "\\\n";
    case "image":
      return `![${escapeText(str(a.alt), options.table)}](${destination(str(a.src))}${title(a.title)})`;
    case "mention": {
      const label =
        str(a.label)
          .replace(/[[\]\n]/g, "")
          .trim() || "member";
      return `@[${label}](mention:${String(a.id)})`;
    }
    case "workItemRef":
      return formatReference(
        { kind: "item", id: String(a.workItemId) },
        str(a.key),
      );
    case "pageRef":
      return formatReference(
        {
          kind: "page",
          id: String(a.pageId),
          ...(typeof a.commitId === "string" && a.commitId
            ? { commitId: a.commitId }
            : {}),
        },
        typeof a.label === "string" && a.label.trim() ? a.label : "Linked page",
      );
    case "decisionRef":
      return formatReference(
        { kind: "decision", id: String(a.decisionId) },
        str(a.label),
      );
    case "rawInline":
      return str(a.source);
    default:
      return renderInline(node.content, options);
  }
}

function indent(text: string, first: string, rest: string) {
  return text
    .split("\n")
    .map((line, i) =>
      line ? (i === 0 ? first : rest) + line : i === 0 ? first.trimEnd() : "",
    )
    .join("\n");
}

// Blocks inside a container, with the same sibling-list rule as the top level.
function renderChildren(nodes: MarkdownJSON[] = [], separator: string) {
  let hint = defaultHint;
  return nodes
    .map((node, i) => {
      const before = nodes[i - 1];
      hint =
        before && isList(before.type) && isList(node.type)
          ? siblingHint(before, node, hint)
          : defaultHint;
      return renderBlock(node, hint);
    })
    .join(separator);
}

/** One block as fresh Markdown (no reuse). */
export function renderBlock(
  node: MarkdownJSON,
  hint: ListHint = defaultHint,
): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      // Spaces and line breaks at the end of a paragraph mean nothing in
      // Markdown (a chip inserted last leaves a space).
      return renderInline(node.content, { table: false }).replace(
        /(?:[ \t]|\\\n)+$/,
        "",
      );
    case "heading": {
      const text = renderInline(node.content, { table: false })
        .replace(/\\\n|\n/g, " ")
        .trimEnd()
        .replace(/#+$/, (m) => `\\${m}`);
      const level = Math.min(6, Math.max(1, Number(a.level) || 1));
      return text ? `${"#".repeat(level)} ${text}` : "#".repeat(level);
    }
    case "horizontalRule":
      return "---";
    case "blockquote":
      return renderChildren(node.content, "\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "codeBlock": {
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      const info = [a.language, a.meta]
        .filter((v) => typeof v === "string" && v)
        .join(" ");
      const char = info.includes("`") ? "~" : "`";
      const longest = Math.max(
        0,
        ...(text.match(char === "`" ? /^ {0,3}`+/gm : /^ {0,3}~+/gm) ?? []).map(
          (s) => s.trim().length,
        ),
      );
      const fence = char.repeat(Math.max(3, longest + 1));
      return `${fence}${info}\n${text ? `${text}\n` : ""}${fence}`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const children = node.content ?? [];
      // Two paragraphs in one item need a blank line, which makes the list loose.
      const spread =
        a.spread === true ||
        children.some((item) =>
          (item.content ?? []).some(
            (c, i, all) =>
              c.type === "paragraph" && all[i + 1]?.type === "paragraph",
          ),
        );
      const start = Number(a.start ?? 1) || 0;
      return children
        .map((item, i) => {
          const marker =
            node.type === "orderedList"
              ? `${start + i}${hint.delimiter} `
              : node.type === "taskList"
                ? `${hint.bullet} [${item.attrs?.checked ? "x" : " "}] `
                : `${hint.bullet} `;
          const width = node.type === "taskList" ? 2 : marker.length;
          const body = renderChildren(item.content, spread ? "\n\n" : "\n");
          return indent(body, marker, " ".repeat(width));
        })
        .join(spread ? "\n\n" : "\n");
    }
    case "table": {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? [])
            .map((p) => renderInline(p.content, { table: true }).trim())
            .join(" "),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(1, ...rows.map((r) => r.length));
      const aligns = Array.from({ length: width }, (_, i) => {
        const align = node.content?.[0]?.content?.[i]?.attrs?.align;
        return align === "left"
          ? ":---"
          : align === "center"
            ? ":---:"
            : align === "right"
              ? "---:"
              : "---";
      });
      const line = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
      return [line(rows[0]!), line(aligns), ...rows.slice(1).map(line)].join(
        "\n",
      );
    }
    case "rawBlock":
      return str(a.source);
    default:
      return renderInline(node.content, { table: false });
  }
}
