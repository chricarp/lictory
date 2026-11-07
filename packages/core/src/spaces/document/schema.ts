import { getSchema, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import { TableKit } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";

export const PAGE_SCHEMA_VERSION = 1;
const blockTypes = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
  "workList",
];
function reference(name: string, attributes: string[]) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    addAttributes: () =>
      Object.fromEntries(attributes.map((key) => [key, { default: null }])),
    parseHTML: () => [{ tag: `span[data-type="${name}"]` }],
    renderHTML: ({ HTMLAttributes }) => [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": name }),
    ],
  });
}
// A read-only, live list of work items (docs/internals/spaces.md): the page
// stores only the query (a project and one narrow filter), never item state.
export const workListFilters = [
  "epic-children",
  "iteration",
  "label",
  "referenced",
] as const;
export type WorkListFilter = (typeof workListFilters)[number];
const workList = Node.create({
  name: "workList",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({
    projectId: { default: null },
    filter: { default: "referenced" },
    // The epic, iteration or label the filter names (none for "referenced").
    filterId: { default: null },
    title: { default: null },
  }),
  parseHTML: () => [{ tag: 'div[data-type="workList"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-type": "workList" }),
  ],
});
/** Link addresses a page keeps: web and mail addresses, Lictory paths and anchors. */
export function isSafePageLink(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/[^/]|#)/i.test(href);
}
/** Shared schema; the browser adds collaboration, cursors and placeholders. */
export function pageExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      underline: false,
      undoRedo: false,
      trailingNode: false,
      // Pasted or typed links the canonical document would reject stay text.
      link: { isAllowedUri: (url) => isSafePageLink(url) },
    }),
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.extend({
      addAttributes() {
        return {
          src: { default: null },
          alt: { default: null },
          title: { default: null },
        };
      },
    }),
    reference("workItemRef", ["workItemId", "key"]),
    // `commitId` pins one version of the page; absent follows the published
    // page (and is left out of the canonical JSON, so documents written
    // before it existed keep their form and hash).
    reference("pageRef", ["pageId", "commitId"]),
    // A recorded Work decision; `label` is what readers without access see.
    reference("decisionRef", ["decisionId", "label"]),
    workList,
    UniqueID.configure({ types: blockTypes, attributeName: "id" }),
  ];
}
export const pageSchema = getSchema(pageExtensions());
