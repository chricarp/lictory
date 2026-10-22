import type { Nodes, PhrasingContent, RootContent, TableCell } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// Markdown → Atlassian Document Format (Jira Cloud rich text). Covers what
// specifications use: headings, paragraphs, emphasis, code, links, lists,
// task lists (acceptance criteria), quotes, rules and GFM tables. Anything
// else degrades to its plain text rather than failing the export.

export type AdfMark = { type: string; attrs?: Record<string, unknown> };
export type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
};
export type AdfDocument = { type: "doc"; version: 1; content: AdfNode[] };

export function markdownToAdf(markdown: string): AdfDocument {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  let ids = 0;
  const localId = () => `lictory-${++ids}`;

  const inline = (nodes: PhrasingContent[], marks: AdfMark[] = []): AdfNode[] =>
    nodes.flatMap((node): AdfNode[] => {
      switch (node.type) {
        case "text":
          return node.value
            ? [{ type: "text", text: node.value, ...withMarks(marks) }]
            : [];
        case "strong":
          return inline(node.children, [...marks, { type: "strong" }]);
        case "emphasis":
          return inline(node.children, [...marks, { type: "em" }]);
        case "delete":
          return inline(node.children, [...marks, { type: "strike" }]);
        case "inlineCode":
          // ADF forbids combining code with other marks except link.
          return [
            {
              type: "text",
              text: node.value,
              marks: [
                ...marks.filter((m) => m.type === "link"),
                { type: "code" },
              ],
            },
          ];
        case "link":
          return inline(node.children, [
            ...marks,
            { type: "link", attrs: { href: node.url } },
          ]);
        case "break":
          return [{ type: "hardBreak" }];
        case "image":
          return node.alt
            ? [{ type: "text", text: node.alt, ...withMarks(marks) }]
            : [];
        default:
          return plain(node) ? [{ type: "text", text: plain(node) }] : [];
      }
    });

  const paragraph = (nodes: PhrasingContent[]): AdfNode => {
    const content = inline(nodes);
    return content.length
      ? { type: "paragraph", content }
      : { type: "paragraph" };
  };

  const blocks = (nodes: RootContent[]): AdfNode[] =>
    nodes.flatMap((node): AdfNode[] => {
      switch (node.type) {
        case "heading":
          return [
            {
              type: "heading",
              attrs: { level: node.depth },
              content: inline(node.children),
            },
          ];
        case "paragraph":
          return [paragraph(node.children)];
        case "thematicBreak":
          return [{ type: "rule" }];
        case "blockquote":
          return [{ type: "blockquote", content: blocks(node.children) }];
        case "code":
          return [
            {
              type: "codeBlock",
              ...(node.lang ? { attrs: { language: node.lang } } : {}),
              content: node.value ? [{ type: "text", text: node.value }] : [],
            },
          ];
        case "list": {
          const isTaskList = node.children.every(
            (item) => typeof item.checked === "boolean",
          );
          if (isTaskList && node.children.length > 0)
            return [
              {
                type: "taskList",
                attrs: { localId: localId() },
                content: node.children.map((item) => ({
                  type: "taskItem",
                  attrs: {
                    localId: localId(),
                    state: item.checked ? "DONE" : "TODO",
                  },
                  // taskItem holds inline content only.
                  content: item.children.flatMap((child) =>
                    child.type === "paragraph"
                      ? inline(child.children)
                      : [{ type: "text", text: plain(child) }],
                  ),
                })),
              },
            ];
          return [
            {
              type: node.ordered ? "orderedList" : "bulletList",
              ...(node.ordered && node.start && node.start !== 1
                ? { attrs: { order: node.start } }
                : {}),
              content: node.children.map((item) => {
                const content = blocks(item.children);
                return {
                  type: "listItem",
                  content: content.length ? content : [{ type: "paragraph" }],
                };
              }),
            },
          ];
        }
        case "table":
          return [
            {
              type: "table",
              attrs: { isNumberColumnEnabled: false, layout: "default" },
              content: node.children.map((row, index) => ({
                type: "tableRow",
                content: row.children.map((cell: TableCell) => ({
                  type: index === 0 ? "tableHeader" : "tableCell",
                  content: [paragraph(cell.children)],
                })),
              })),
            },
          ];
        case "html":
          return node.value.trim()
            ? [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: node.value }],
                },
              ]
            : [];
        default: {
          const text = plain(node);
          return text
            ? [{ type: "paragraph", content: [{ type: "text", text }] }]
            : [];
        }
      }
    });

  return { type: "doc", version: 1, content: blocks(tree.children) };
}

function withMarks(marks: AdfMark[]) {
  return marks.length ? { marks } : {};
}

function plain(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as Nodes[]).map(plain).join("");
  return "";
}
