import {
  Extension,
  getExtensionField,
  getSchema,
  type Mark,
  mergeAttributes,
  Node,
  type AnyExtension,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableCell, TableHeader, TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { isSafePageLink } from "@lictory/core/spaces/document/schema";

// The schema of Markdown-backed documents: specifications, descriptions,
// discussions and decisions. Markdown stays the stored format; this schema is
// what the rich editor shows while someone writes. It covers everything
// specifications use (headings 1–6, lists, task lists, tables with
// alignment, fenced code with its info string, quotes, links, inline images
// and attachments, mentions, references, hard breaks) and keeps whatever it
// cannot represent verbatim in `rawBlock` and `rawInline` nodes, so opening
// and saving never loses text. See `markdown.ts` for the conversion.
//
// References and mentions use the same node names as page documents, plus
// the label a Markdown reader sees: `workItemRef{workItemId,key}`,
// `pageRef{pageId,commitId,label}`, `decisionRef{decisionId,label}`,
// `mention{id,label}`.

function atom(name: string, attributes: string[], group = "inline") {
  const inline = group === "inline";
  return Node.create({
    name,
    group,
    inline,
    atom: true,
    selectable: true,
    draggable: !inline,
    addAttributes: () =>
      Object.fromEntries(
        attributes.map((key) => [key, { default: null, rendered: false }]),
      ),
    parseHTML: () => [
      { tag: `${inline ? "span" : "div"}[data-type="${name}"]` },
    ],
    renderHTML: ({ HTMLAttributes }) => [
      inline ? "span" : "div",
      mergeAttributes(HTMLAttributes, { "data-type": name }),
    ],
  });
}

// Markdown facts the visible schema does not carry: whether a list is loose
// (blank lines between its items), a code fence's text after the language,
// and a table column's alignment.
const MarkdownAttributes = Extension.create({
  name: "markdownAttributes",
  addGlobalAttributes: () => [
    {
      types: ["bulletList", "orderedList", "taskList"],
      attributes: { spread: { default: false, rendered: false } },
    },
    {
      types: ["codeBlock"],
      attributes: { meta: { default: null, rendered: false } },
    },
    {
      types: ["tableCell", "tableHeader"],
      attributes: {
        align: {
          default: null,
          renderHTML: (attributes: Record<string, unknown>) =>
            typeof attributes.align === "string"
              ? { style: `text-align: ${attributes.align}` }
              : {},
        },
      },
    },
  ],
});

// StarterKit's own extensions, with inline code that combines with other
// marks: Markdown writes code inside a link or bold text (`[\`x\`](url)`).
function starterKit(): AnyExtension[] {
  const kit = StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    underline: false,
    undoRedo: false,
    trailingNode: false,
    link: {
      openOnClick: false,
      // What a person pastes or types becomes a link only with a safe
      // address; links read from Markdown keep theirs (readers sanitize).
      isAllowedUri: (url) => isSafePageLink(url),
    },
  });
  const children = getExtensionField<() => AnyExtension[]>(
    kit,
    "addExtensions",
    { name: kit.name, options: kit.options, storage: kit.storage },
  );
  return (children?.() ?? []).map((extension) =>
    extension.name === "code"
      ? (extension as Mark).extend({ excludes: "" })
      : extension,
  );
}

/** Shared schema; the browser adds history, placeholders, pickers and views. */
export function markdownExtensions(): AnyExtension[] {
  return [
    ...starterKit(),
    // A Markdown table cell holds one line of inline content.
    TableKit.configure({ tableCell: false, tableHeader: false }),
    TableCell.extend({ content: "paragraph" }),
    TableHeader.extend({ content: "paragraph" }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true }).extend({
      addAttributes() {
        return {
          src: { default: null },
          alt: { default: null },
          title: { default: null },
        };
      },
    }),
    MarkdownAttributes,
    atom("mention", ["id", "label"]),
    atom("workItemRef", ["workItemId", "key"]),
    atom("pageRef", ["pageId", "commitId", "label"]),
    atom("decisionRef", ["decisionId", "label"]),
    // Markdown the editor cannot show (raw HTML, footnotes, link reference
    // definitions…), kept exactly as written.
    atom("rawInline", ["source"]),
    atom("rawBlock", ["source"], "block"),
  ];
}

export const markdownSchema = getSchema(markdownExtensions());
