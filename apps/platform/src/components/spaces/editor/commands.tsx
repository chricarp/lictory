import type { ReactNode } from "react";
import type { Editor, Range } from "@tiptap/core";
import {
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Table,
} from "lucide-react";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import {
  fileUrl,
  uploadFile,
  type FileContext,
} from "@lictory/platform/components/items/file-upload";
import type { MenuItem } from "@lictory/platform/components/spaces/editor/suggestions";
import { workBlockSlashItems } from "@lictory/platform/components/spaces/blocks/insert-store";

// The blocks of the page schema as commands, shared by the toolbar and
// the "/" menu, and the inserts for references and images.

type Block = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  apply: (editor: Editor) => void;
};

const icon = "size-4";
export const blocks: Block[] = [
  {
    id: "paragraph",
    label: "Text",
    icon: <Pilcrow className={icon} />,
    keywords: "text paragraph plain",
    apply: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `heading${level}`,
    label: `Heading ${level}`,
    hint: "#".repeat(level),
    icon:
      level === 1 ? (
        <Heading1 className={icon} />
      ) : level === 2 ? (
        <Heading2 className={icon} />
      ) : (
        <Heading3 className={icon} />
      ),
    keywords: `heading title h${level}`,
    apply: (e: Editor) => e.chain().focus().toggleHeading({ level }).run(),
  })),
  {
    id: "bulletList",
    label: "Bulleted list",
    hint: "-",
    icon: <List className={icon} />,
    keywords: "bullet list unordered",
    apply: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    hint: "1.",
    icon: <ListOrdered className={icon} />,
    keywords: "numbered ordered list",
    apply: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "taskList",
    label: "Task list",
    hint: "[ ]",
    icon: <ListChecks className={icon} />,
    keywords: "task todo checklist checkbox",
    apply: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    hint: ">",
    icon: <Quote className={icon} />,
    keywords: "quote blockquote citation",
    apply: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "codeBlock",
    label: "Code block",
    hint: "```",
    icon: <SquareCode className={icon} />,
    keywords: "code block snippet pre",
    apply: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "table",
    label: "Table",
    icon: <Table className={icon} />,
    keywords: "table grid columns rows",
    apply: (e) =>
      e
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "horizontalRule",
    label: "Divider",
    hint: "---",
    icon: <Minus className={icon} />,
    keywords: "divider rule separator line",
    apply: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

const matches = (query: string, ...values: string[]) => {
  const q = query.trim().toLowerCase();
  return !q || values.some((v) => v.toLowerCase().includes(q));
};

// The "/" menu: blocks, then images and references.
export function slashItems(
  query: string,
  extras: { image?: () => void },
): MenuItem[] {
  const items: MenuItem[] = blocks
    .filter((b) => matches(query, b.label, b.keywords))
    .map((b) => ({
      id: b.id,
      label: b.label,
      hint: b.hint,
      icon: b.icon,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        b.apply(editor);
      },
    }));
  if (extras.image && matches(query, "image picture photo upload"))
    items.push({
      id: "image",
      label: "Image",
      icon: <ImagePlus className={icon} />,
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        extras.image!();
      },
    });
  if (matches(query, "work item issue story task bug mention"))
    items.push({
      id: "workItem",
      label: "Work item",
      hint: "#",
      icon: <Hash className={icon} />,
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).insertContent("#").run(),
    });
  if (matches(query, "page link"))
    items.push({
      id: "pageLink",
      label: "Link to page",
      hint: "[[",
      icon: <FileText className={icon} />,
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).insertContent("[[").run(),
    });
  items.push(...workBlockSlashItems(query));
  return items;
}

export function insertWorkItem(
  editor: Editor,
  range: Range | null,
  item: { id: string; key: string },
) {
  const chain = editor.chain().focus();
  (range ? chain.deleteRange(range) : chain)
    .insertContent([
      { type: "workItemRef", attrs: { workItemId: item.id, key: item.key } },
      { type: "text", text: " " },
    ])
    .run();
}

export function insertPageLink(
  editor: Editor,
  range: Range | null,
  pageId: string,
) {
  const chain = editor.chain().focus();
  (range ? chain.deleteRange(range) : chain)
    .insertContent([
      { type: "pageRef", attrs: { pageId } },
      { type: "text", text: " " },
    ])
    .run();
}

export function workItemItems(
  query: string,
  items: readonly WorkItem[],
  keyOf: (item: WorkItem) => string,
): MenuItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((item) => !item.archivedAt)
    .map((item) => ({ item, key: keyOf(item) }))
    .filter(
      ({ item, key }) =>
        !q ||
        key.toLowerCase().startsWith(q) ||
        item.title.toLowerCase().includes(q),
    )
    .slice(0, 8)
    .map(({ item, key }) => ({
      id: item.id,
      label: item.title,
      hint: key,
      run: (editor, range) =>
        insertWorkItem(editor, range, { id: item.id, key }),
    }));
}

export function pageItems(
  query: string,
  pages: readonly { id: string; title: string; space: string }[],
  currentPageId: string,
): MenuItem[] {
  const q = query.trim().toLowerCase();
  return pages
    .filter((p) => p.id !== currentPageId)
    .filter((p) => !q || p.title.toLowerCase().includes(q))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      label: p.title,
      hint: p.space,
      icon: <FileText className={icon} />,
      run: (editor, range) => insertPageLink(editor, range, p.id),
    }));
}

// Uploads images as page files and inserts them (at `at`, or the
// selection), one after another. Non-images are ignored.
export async function insertImages(
  editor: Editor,
  files: readonly File[],
  context: FileContext,
  at?: number,
) {
  let position = at;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const entry = await uploadFile(file, context);
    if (editor.isDestroyed) return;
    const node = {
      type: "image",
      attrs: { src: fileUrl(entry.id), alt: file.name },
    };
    if (position === undefined)
      editor.chain().focus().insertContent(node).run();
    else {
      editor.chain().focus().insertContentAt(position, node).run();
      position = editor.state.selection.to;
    }
  }
}
