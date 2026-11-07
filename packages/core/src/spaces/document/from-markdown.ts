import type { Nodes, PhrasingContent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseReferenceTarget } from "@lictory/core/contracts/references";
import { canonicalizeDocument, type PageNode } from "./canonical";
import { isSafePageLink } from "./schema";

// GFM Markdown → canonical page content, for callers that cannot type into a
// live draft (agents proposing a change, imports). The inverse of
// `documentToMarkdown` for what pages support: headings (deeper levels
// become level 3), paragraphs, emphasis, strike, code, safe links, lists,
// task lists, quotes, code blocks, rules, tables, images with a Lictory file
// reference or HTTPS URL, and references (`[PAY-2](item:ID)`,
// `[Title](page:ID)`, `[Title](page:ID@COMMIT)`, `[label](decision:ID)` and
// the older `[[page:ID]]`), so a page exported to Markdown and read back keeps
// what it refers to. Anything else degrades to its plain text instead of
// failing; a bare work item key stays text. Every block receives a new
// stable id.

type Mark = NonNullable<PageNode["marks"]>[number];

const safeImage = (src: string) =>
  /^\/api\/files\/[a-zA-Z0-9_-]+$/.test(src) ||
  /^https:\/\/[^@\s]+$/i.test(src);

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join("");
  return "";
}

// Text with `[[page:ID]]` references turned into page reference nodes.
function textNodes(value: string, marks: Mark[]): PageNode[] {
  const out: PageNode[] = [];
  const pattern = /\[\[page:([A-Za-z0-9_-]{1,160})\]\]/g;
  let last = 0;
  const push = (text: string) => {
    if (text)
      out.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
  };
  for (const match of value.matchAll(pattern)) {
    push(value.slice(last, match.index));
    out.push({ type: "pageRef", attrs: { pageId: match[1]! } });
    last = match.index + match[0].length;
  }
  push(value.slice(last));
  return out;
}

function inline(nodes: PhrasingContent[], marks: Mark[] = []): PageNode[] {
  return nodes.flatMap((node): PageNode[] => {
    switch (node.type) {
      case "text":
        return textNodes(node.value, marks);
      case "strong":
        return inline(node.children, [...marks, { type: "bold" }]);
      case "emphasis":
        return inline(node.children, [...marks, { type: "italic" }]);
      case "delete":
        return inline(node.children, [...marks, { type: "strike" }]);
      case "inlineCode":
        // Code excludes every other mark in the page schema.
        return node.value
          ? [{ type: "text", text: node.value, marks: [{ type: "code" }] }]
          : [];
      case "link": {
        const target = parseReferenceTarget(node.url);
        const label = plain(node).trim();
        if (target?.kind === "item")
          return [
            {
              type: "workItemRef",
              attrs: { workItemId: target.id, key: label || "Work item" },
            },
          ];
        if (target?.kind === "page")
          return [
            {
              type: "pageRef",
              attrs: target.commitId
                ? { pageId: target.id, commitId: target.commitId }
                : { pageId: target.id },
            },
          ];
        if (target?.kind === "decision")
          return [
            {
              type: "decisionRef",
              attrs: { decisionId: target.id, label: label || "Decision" },
            },
          ];
        return inline(
          node.children,
          isSafePageLink(node.url)
            ? [...marks, { type: "link", attrs: { href: node.url } }]
            : marks,
        );
      }
      case "break":
        return [{ type: "hardBreak" }];
      case "image":
        // Inline images become their alternative text; block images are
        // handled by `blocks`.
        return node.alt ? textNodes(node.alt, marks) : [];
      default: {
        const text = plain(node);
        return text ? textNodes(text, marks) : [];
      }
    }
  });
}

const paragraph = (content: PageNode[]): PageNode =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

// A paragraph consisting only of one image is an image block.
function imageBlock(children: PhrasingContent[]): PageNode | null {
  if (children.length !== 1 || children[0]!.type !== "image") return null;
  const image = children[0];
  if (!safeImage(image.url)) return null;
  return {
    type: "image",
    attrs: {
      src: image.url,
      alt: image.alt ?? null,
      title: image.title ?? null,
    },
  };
}

// List items and task items start with a paragraph.
function itemContent(children: RootContent[]): PageNode[] {
  const content = blocks(children);
  return content[0]?.type === "paragraph"
    ? content
    : [{ type: "paragraph" }, ...content];
}

function blocks(nodes: RootContent[]): PageNode[] {
  return nodes.flatMap((node): PageNode[] => {
    switch (node.type) {
      case "heading": {
        const content = inline(node.children);
        return [
          {
            type: "heading",
            attrs: { level: Math.min(node.depth, 3) },
            ...(content.length ? { content } : {}),
          },
        ];
      }
      case "paragraph":
        return [imageBlock(node.children) ?? paragraph(inline(node.children))];
      case "thematicBreak":
        return [{ type: "horizontalRule" }];
      case "blockquote": {
        const content = blocks(node.children);
        return [
          {
            type: "blockquote",
            content: content.length ? content : [{ type: "paragraph" }],
          },
        ];
      }
      case "code":
        return [
          {
            type: "codeBlock",
            attrs: { language: node.lang ?? null },
            ...(node.value
              ? { content: [{ type: "text", text: node.value }] }
              : {}),
          },
        ];
      case "list": {
        if (!node.children.length) return [];
        const tasks = node.children.every(
          (item) => typeof item.checked === "boolean",
        );
        if (tasks)
          return [
            {
              type: "taskList",
              content: node.children.map((item) => ({
                type: "taskItem",
                attrs: { checked: item.checked === true },
                content: itemContent(item.children),
              })),
            },
          ];
        return [
          {
            type: node.ordered ? "orderedList" : "bulletList",
            ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
            content: node.children.map((item) => ({
              type: "listItem",
              content: itemContent(item.children),
            })),
          },
        ];
      }
      case "table":
        return node.children.length
          ? [
              {
                type: "table",
                content: node.children.map((row, index) => ({
                  type: "tableRow",
                  content: row.children.map((cell) => ({
                    type: index === 0 ? "tableHeader" : "tableCell",
                    content: [paragraph(inline(cell.children))],
                  })),
                })),
              },
            ]
          : [];
      case "html":
        return node.value.trim() ? [paragraph(textNodes(node.value, []))] : [];
      default: {
        const text = plain(node);
        return text ? [paragraph(textNodes(text, []))] : [];
      }
    }
  });
}

/** Throws `PageDocumentError` when the result is not valid page content. */
export function markdownToDocument(markdown: string): PageNode {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const content = blocks(tree.children);
  return canonicalizeDocument({
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  });
}
