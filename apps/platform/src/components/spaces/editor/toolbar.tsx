import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Code,
  FileText,
  Hash,
  ImagePlus,
  Italic,
  MessageSquarePlus,
  Redo2,
  Strikethrough,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { blocks } from "@lictory/platform/components/spaces/editor/commands";

// The formatting toolbar: one tab stop (WAI-ARIA toolbar pattern, roving
// tabindex), arrow keys, Home and End move between controls, every
// control is labelled and toggles say whether they are on. On narrow
// screens it is one scrollable row.

type Control = {
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
  separatorBefore?: boolean;
};

const icon = "size-4";
const mod =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

export function Toolbar({
  editor,
  onImage,
  onComment,
  disabled,
}: {
  editor: Editor;
  onImage?: () => void;
  onComment?: () => void;
  disabled: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      block: blocks.find((b) =>
        b.id.startsWith("heading")
          ? e.isActive("heading", { level: Number(b.id.slice(7)) })
          : e.isActive(b.id),
      )?.id,
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      selection: !e.state.selection.empty,
    }),
  });
  const controls: Control[] = [
    {
      id: "undo",
      label: "Undo",
      shortcut: `${mod}Z`,
      icon: <Undo2 className={icon} />,
      disabled: !state.canUndo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      id: "redo",
      label: "Redo",
      shortcut: `${mod}Shift+Z`,
      icon: <Redo2 className={icon} />,
      disabled: !state.canRedo,
      run: () => editor.chain().focus().redo().run(),
    },
    ...blocks
      .filter((b) => b.id !== "table" && b.id !== "horizontalRule")
      .map((b, index) => ({
        id: b.id,
        label: b.label,
        icon: b.icon,
        pressed: state.block === b.id,
        run: () => b.apply(editor),
        separatorBefore: index === 0,
      })),
    {
      id: "bold",
      label: "Bold",
      shortcut: `${mod}B`,
      icon: <Bold className={icon} />,
      pressed: state.bold,
      run: () => editor.chain().focus().toggleBold().run(),
      separatorBefore: true,
    },
    {
      id: "italic",
      label: "Italic",
      shortcut: `${mod}I`,
      icon: <Italic className={icon} />,
      pressed: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: "strike",
      label: "Strikethrough",
      shortcut: `${mod}Shift+S`,
      icon: <Strikethrough className={icon} />,
      pressed: state.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      id: "code",
      label: "Inline code",
      shortcut: `${mod}E`,
      icon: <Code className={icon} />,
      pressed: state.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    ...blocks
      .filter((b) => b.id === "table" || b.id === "horizontalRule")
      .map((b, index) => ({
        id: b.id,
        label: b.label,
        icon: b.icon,
        run: () => b.apply(editor),
        separatorBefore: index === 0,
      })),
    ...(onImage
      ? [
          {
            id: "image",
            label: "Image",
            icon: <ImagePlus className={icon} />,
            run: onImage,
          },
        ]
      : []),
    {
      id: "workItem",
      label: "Mention a work item",
      shortcut: "#",
      icon: <Hash className={icon} />,
      run: () => editor.chain().focus().insertContent(" #").run(),
      separatorBefore: true,
    },
    {
      id: "pageLink",
      label: "Link to a page",
      shortcut: "[[",
      icon: <FileText className={icon} />,
      run: () => editor.chain().focus().insertContent(" [[").run(),
    },
    ...(onComment
      ? [
          {
            id: "comment",
            label: "Comment on selection",
            shortcut: `${mod}Alt+M`,
            icon: <MessageSquarePlus className={icon} />,
            disabled: !state.selection,
            run: onComment,
          },
        ]
      : []),
    ...(state.table
      ? [
          {
            id: "addRow",
            label: "Add row below",
            icon: <BetweenHorizontalEnd className={icon} />,
            run: () => editor.chain().focus().addRowAfter().run(),
            separatorBefore: true,
          },
          {
            id: "addColumn",
            label: "Add column after",
            icon: <BetweenVerticalEnd className={icon} />,
            run: () => editor.chain().focus().addColumnAfter().run(),
          },
          {
            id: "deleteRow",
            label: "Delete row",
            icon: <Trash2 className={icon} />,
            run: () => editor.chain().focus().deleteRow().run(),
          },
          {
            id: "deleteColumn",
            label: "Delete column",
            icon: <Trash2 className={cn(icon, "rotate-90")} />,
            run: () => editor.chain().focus().deleteColumn().run(),
          },
          {
            id: "deleteTable",
            label: "Delete table",
            icon: <Trash2 className={cn(icon, "text-destructive")} />,
            run: () => editor.chain().focus().deleteTable().run(),
          },
        ]
      : []),
  ];
  const [current, setCurrent] = useState(0);
  const focusIndex = Math.min(current, controls.length - 1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (index: number) => {
    const next = (index + controls.length) % controls.length;
    setCurrent(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") move(focusIndex + 1);
    else if (event.key === "ArrowLeft") move(focusIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(controls.length - 1);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className="flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-full bg-card px-1.5 py-1 ring-1 ring-foreground/8"
    >
      {controls.map((control, index) => (
        <span key={control.id} className="flex shrink-0 items-center">
          {control.separatorBefore && index > 0 && (
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          )}
          <button
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            tabIndex={index === focusIndex ? 0 : -1}
            aria-label={control.label}
            aria-pressed={control.pressed}
            title={
              control.shortcut
                ? `${control.label} (${control.shortcut})`
                : control.label
            }
            // Unavailable controls stay focusable so the toolbar keeps its
            // tab stop and arrow order.
            aria-disabled={
              disabled || control.disabled === true ? true : undefined
            }
            // Keeps the editor's selection while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onFocus={() => setCurrent(index)}
            onClick={() => {
              if (!disabled && control.disabled !== true) control.run();
            }}
            className={cn(
              "grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-disabled:opacity-40",
              control.pressed && "bg-muted text-foreground",
            )}
          >
            {control.icon}
          </button>
        </span>
      ))}
    </div>
  );
}
