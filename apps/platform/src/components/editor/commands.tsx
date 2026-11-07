import type { ReactNode } from "react";
import type { Editor, Range } from "@tiptap/core";
import {
  FileText,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImagePlus,
  Paperclip,
  Scale,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Table,
} from "lucide-react";
import { matchesPerson } from "@lictory/core/lib/handles";
import { Avatar } from "@lictory/ui/primitives";
import {
  fileUrl,
  uploadFile,
  type FileContext,
} from "@lictory/platform/components/items/file-upload";
import type { MenuItem } from "@lictory/platform/components/editor/suggestions";

// The blocks of the editor schemas as commands, shared by the toolbar and
// the "/" menu, and the inserts for references, mentions, images and files.
// Page documents and Markdown documents use the same node names; inserts
// pass only the attributes the editor's schema has.

type Block = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  apply: (editor: Editor) => void;
};

const icon = "size-4";
const headingIcons = [
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
];
function heading(level: 1 | 2 | 3 | 4 | 5 | 6): Block {
  const Icon = headingIcons[level - 1]!;
  return {
    id: `heading${level}`,
    label: `Heading ${level}`,
    hint: "#".repeat(level),
    icon: <Icon className={icon} />,
    keywords: `heading title h${level}`,
    apply: (e: Editor) => e.chain().focus().toggleHeading({ level }).run(),
  };
}
// Smaller headings Markdown documents may hold: shown as the current style,
// offered by Markdown shortcuts ("#### ").
export const smallHeadings: Block[] = ([4, 5, 6] as const).map(heading);
export const blocks: Block[] = [
  {
    id: "paragraph",
    label: "Text",
    icon: <Pilcrow className={icon} />,
    keywords: "text paragraph plain",
    apply: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level) => heading(level)),
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

// The "/" menu: blocks, then images and files, then references.
export function slashItems(
  query: string,
  extras: {
    image?: () => void;
    file?: () => void;
    decision?: () => void;
    mention?: boolean;
  },
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
  const action = (
    id: string,
    label: string,
    keywords: string,
    node: ReactNode,
    run: () => void,
  ) => {
    if (matches(query, label, keywords))
      items.push({
        id,
        label,
        icon: node,
        run: (editor, range) => {
          editor.chain().focus().deleteRange(range).run();
          run();
        },
      });
  };
  if (extras.image)
    action(
      "image",
      "Image",
      "image picture photo upload",
      <ImagePlus className={icon} />,
      extras.image,
    );
  if (extras.file)
    action(
      "file",
      "File or image",
      "file attachment upload image document",
      <Paperclip className={icon} />,
      extras.file,
    );
  const trigger = (
    id: string,
    label: string,
    keywords: string,
    hint: string,
    node: ReactNode,
  ) => {
    if (matches(query, label, keywords))
      items.push({
        id,
        label,
        hint,
        icon: node,
        run: (editor, range) =>
          editor.chain().focus().deleteRange(range).insertContent(hint).run(),
      });
  };
  trigger(
    "workItem",
    "Work item",
    "work item issue story task bug reference",
    "#",
    <Hash className={icon} />,
  );
  trigger(
    "pageLink",
    "Link to page",
    "page link knowledge space reference",
    "[[",
    <FileText className={icon} />,
  );
  if (extras.decision)
    action(
      "decision",
      "Decision",
      "decision agreed recorded conclusion reference",
      <Scale className={icon} />,
      extras.decision,
    );
  if (extras.mention)
    trigger(
      "mention",
      "Mention someone",
      "mention person people member notify",
      "@",
      <span className="grid size-4 place-items-center font-mono text-[13px]">
        @
      </span>,
    );
  return items;
}

// Attributes the editor's schema has (page and Markdown documents differ).
function attrsFor(
  editor: Editor,
  type: string,
  attrs: Record<string, unknown>,
) {
  const known = editor.schema.nodes[type]?.spec.attrs ?? {};
  return Object.fromEntries(
    Object.entries(attrs).filter(([key]) => Object.hasOwn(known, key)),
  );
}

function insertAtom(
  editor: Editor,
  range: Range | null,
  type: string,
  attrs: Record<string, unknown>,
) {
  const chain = editor.chain().focus();
  (range ? chain.deleteRange(range) : chain)
    .insertContent([
      { type, attrs: attrsFor(editor, type, attrs) },
      { type: "text", text: " " },
    ])
    .run();
}

export function insertWorkItem(
  editor: Editor,
  range: Range | null,
  item: { id: string; key: string },
) {
  insertAtom(editor, range, "workItemRef", {
    workItemId: item.id,
    key: item.key,
  });
}

export function insertPageLink(
  editor: Editor,
  range: Range | null,
  page: { id: string; title: string; commitId?: string | null },
) {
  insertAtom(editor, range, "pageRef", {
    pageId: page.id,
    commitId: page.commitId ?? null,
    label: page.title,
  });
}

export function insertDecision(
  editor: Editor,
  range: Range | null,
  decision: { id: string; title: string },
) {
  insertAtom(editor, range, "decisionRef", {
    decisionId: decision.id,
    label: decision.title,
  });
}

export function workItemItems(
  query: string,
  items: readonly {
    id: string;
    key: string;
    title: string;
    archived: boolean;
  }[],
): MenuItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((item) => !item.archived)
    .filter(
      (item) =>
        !q ||
        item.key.toLowerCase().startsWith(q) ||
        item.title.toLowerCase().includes(q),
    )
    .slice(0, 8)
    .map((item) => ({
      id: item.id,
      label: item.title,
      hint: item.key,
      run: (editor, range) => insertWorkItem(editor, range, item),
    }));
}

export function pageItems(
  query: string,
  pages: readonly {
    id: string;
    title: string;
    space: string;
    path?: readonly string[];
    publishedCommitId: string;
    archived: boolean;
  }[],
  currentPageId?: string,
): MenuItem[] {
  const q = query.trim().toLowerCase();
  return pages
    .filter((p) => p.id !== currentPageId && !p.archived)
    .filter((p) => !q || p.title.toLowerCase().includes(q))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      label: p.title,
      // Where it is, on a line of its own so the title keeps its width.
      detail: [p.space, ...(p.path ?? [])].filter(Boolean).join(" / "),
      icon: <FileText className={icon} />,
      run: (editor, range) => insertPageLink(editor, range, p),
      // Cite the version published now; the chip then says when a newer
      // one exists.
      alternate: {
        label: "Pin this version",
        run: (editor, range) =>
          insertPageLink(editor, range, {
            ...p,
            commitId: p.publishedCommitId,
          }),
      },
    }));
}

export type Mentionable = {
  id: string;
  name: string;
  email?: string;
  handle?: string | null;
};

export function mentionItems(
  query: string,
  people: readonly Mentionable[],
): MenuItem[] {
  const q = query.toLowerCase();
  return (
    people
      .filter((m) => matchesPerson(m, query))
      // Handle-prefix matches first: that is what people type after @.
      .sort(
        (a, b) =>
          Number(!a.handle?.startsWith(q)) - Number(!b.handle?.startsWith(q)),
      )
      .slice(0, 6)
      .map((person) => ({
        id: person.id,
        label: person.name,
        hint: person.handle ? `@${person.handle}` : person.email,
        icon: <Avatar userId={person.id} name={person.name} size="xs" />,
        run: (editor, range) => insertMention(editor, range, person),
      }))
  );
}

export function insertMention(
  editor: Editor,
  range: Range | null,
  person: Mentionable,
) {
  insertAtom(editor, range, "mention", {
    id: person.id,
    label:
      (person.handle ?? person.name).replace(/[[\]\n]/g, "").trim() || "member",
  });
}

// Uploads images as page files and inserts them (at `at`, or the
// selection), one after another. Non-images are ignored. Page documents.
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

// Uploads files and inserts them where they were dropped or at the
// selection: images as inline images, other files as links with their name,
// the Markdown specifications always used (`![name](/api/files/{id})`,
// `[name](/api/files/{id})`). Markdown documents.
export async function insertFiles(
  editor: Editor,
  files: readonly File[],
  context: FileContext,
  at?: number,
) {
  let position = at;
  for (const file of files) {
    const entry = await uploadFile(file, context);
    if (editor.isDestroyed) return;
    const href = fileUrl(entry.id);
    const content = file.type.startsWith("image/")
      ? [{ type: "image", attrs: { src: href, alt: file.name } }]
      : [
          {
            type: "text",
            text: file.name,
            marks: [{ type: "link", attrs: { href } }],
          },
          { type: "text", text: " " },
        ];
    if (position === undefined)
      editor.chain().focus().insertContent(content).run();
    else {
      editor.chain().focus().insertContentAt(position, content).run();
      position = editor.state.selection.to;
    }
  }
}
