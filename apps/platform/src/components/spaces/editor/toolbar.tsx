import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  ChevronDown,
  Code,
  FileText,
  Hash,
  ImagePlus,
  Italic,
  Link2,
  MessageSquarePlus,
  Plus,
  Redo2,
  Strikethrough,
  Table,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { blocks } from "@lictory/platform/components/spaces/editor/commands";
import {
  Menu,
  MenuItem,
  MenuSeparator,
} from "@lictory/platform/components/spaces/menu";

// The formatting toolbar: one tab stop (WAI-ARIA toolbar pattern, roving
// tabindex), arrow keys, Home and End move between controls, every
// control is labelled and toggles say whether they are on. What people
// reach for while writing stays visible (undo, the inline marks, a link,
// a comment); block styles sit in one "Text" menu and everything that
// inserts something in "Insert". Inside a table a "Table" menu appears.
// On narrow screens it is one scrollable row.

const icon = "size-4";
const mod =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

type ButtonControl = {
  kind: "button";
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
  separatorBefore?: boolean;
};
type MenuControl = {
  kind: "menu";
  id: string;
  label: string;
  // What the trigger shows (the current block style, "Insert").
  text: string;
  icon: ReactNode;
  menu: (close: () => void) => ReactNode;
  width?: number;
  separatorBefore?: boolean;
  pressed?: boolean;
};
type Control = ButtonControl | MenuControl;

const blockStyles = blocks.filter(
  (b) => b.id !== "table" && b.id !== "horizontalRule",
);
const inserts = blocks.filter(
  (b) => b.id === "table" || b.id === "horizontalRule",
);

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
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
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
  const current = blockStyles.find((b) => b.id === state.block);
  const controls: Control[] = [
    {
      kind: "button",
      id: "undo",
      label: "Undo",
      shortcut: `${mod}Z`,
      icon: <Undo2 className={icon} />,
      disabled: !state.canUndo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      kind: "button",
      id: "redo",
      label: "Redo",
      shortcut: `${mod}Shift+Z`,
      icon: <Redo2 className={icon} />,
      disabled: !state.canRedo,
      run: () => editor.chain().focus().redo().run(),
    },
    {
      kind: "menu",
      id: "block",
      label: `Text style: ${current?.label ?? "Text"}`,
      text: current?.label ?? "Text",
      icon: current?.icon ?? blockStyles[0]!.icon,
      separatorBefore: true,
      width: 220,
      menu: (close) => (
        <Menu label="Text style">
          {blockStyles.map((b) => (
            <MenuItem
              key={b.id}
              icon={b.icon}
              checked={b.id === (state.block ?? "paragraph")}
              hint={b.hint}
              onSelect={() => {
                close();
                b.apply(editor);
              }}
            >
              {b.label}
            </MenuItem>
          ))}
        </Menu>
      ),
    },
    {
      kind: "button",
      id: "bold",
      label: "Bold",
      shortcut: `${mod}B`,
      icon: <Bold className={icon} />,
      pressed: state.bold,
      run: () => editor.chain().focus().toggleBold().run(),
      separatorBefore: true,
    },
    {
      kind: "button",
      id: "italic",
      label: "Italic",
      shortcut: `${mod}I`,
      icon: <Italic className={icon} />,
      pressed: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      kind: "button",
      id: "strike",
      label: "Strikethrough",
      shortcut: `${mod}Shift+S`,
      icon: <Strikethrough className={icon} />,
      pressed: state.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      kind: "button",
      id: "code",
      label: "Inline code",
      shortcut: `${mod}E`,
      icon: <Code className={icon} />,
      pressed: state.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      kind: "menu",
      id: "link",
      label: state.link ? "Edit link" : "Link",
      text: "",
      icon: <Link2 className={icon} />,
      pressed: state.link,
      width: 300,
      menu: (close) => (
        <LinkForm
          editor={editor}
          href={state.href}
          linked={state.link}
          close={close}
        />
      ),
    },
    {
      kind: "menu",
      id: "insert",
      label: "Insert",
      text: "Insert",
      icon: <Plus className={icon} />,
      separatorBefore: true,
      width: 220,
      menu: (close) => (
        <Menu label="Insert">
          {inserts.map((b) => (
            <MenuItem
              key={b.id}
              icon={b.icon}
              hint={b.hint}
              onSelect={() => {
                close();
                b.apply(editor);
              }}
            >
              {b.label}
            </MenuItem>
          ))}
          {onImage && (
            <MenuItem
              icon={<ImagePlus />}
              onSelect={() => {
                close();
                onImage();
              }}
            >
              Image
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            icon={<Hash />}
            hint="#"
            onSelect={() => {
              close();
              editor.chain().focus().insertContent(" #").run();
            }}
          >
            Work item
          </MenuItem>
          <MenuItem
            icon={<FileText />}
            hint="[["
            onSelect={() => {
              close();
              editor.chain().focus().insertContent(" [[").run();
            }}
          >
            Link to a page
          </MenuItem>
        </Menu>
      ),
    },
    ...(state.table
      ? [
          {
            kind: "menu" as const,
            id: "table",
            label: "Table",
            text: "Table",
            icon: <Table className={icon} />,
            width: 220,
            menu: (close: () => void) => (
              <Menu label="Table">
                <MenuItem
                  icon={<BetweenHorizontalEnd />}
                  onSelect={() => {
                    close();
                    editor.chain().focus().addRowAfter().run();
                  }}
                >
                  Add row below
                </MenuItem>
                <MenuItem
                  icon={<BetweenVerticalEnd />}
                  onSelect={() => {
                    close();
                    editor.chain().focus().addColumnAfter().run();
                  }}
                >
                  Add column after
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={<Trash2 />}
                  onSelect={() => {
                    close();
                    editor.chain().focus().deleteRow().run();
                  }}
                >
                  Delete row
                </MenuItem>
                <MenuItem
                  icon={<Trash2 className="rotate-90" />}
                  onSelect={() => {
                    close();
                    editor.chain().focus().deleteColumn().run();
                  }}
                >
                  Delete column
                </MenuItem>
                <MenuItem
                  icon={<Trash2 className="text-destructive" />}
                  className="text-destructive"
                  onSelect={() => {
                    close();
                    editor.chain().focus().deleteTable().run();
                  }}
                >
                  Delete table
                </MenuItem>
              </Menu>
            ),
          },
        ]
      : []),
    ...(onComment
      ? [
          {
            kind: "button" as const,
            id: "comment",
            label: "Comment on selection",
            shortcut: `${mod}Alt+M`,
            icon: <MessageSquarePlus className={icon} />,
            disabled: !state.selection,
            run: onComment,
            separatorBefore: true,
          },
        ]
      : []),
  ];
  const [focused, setFocused] = useState(0);
  const focusIndex = Math.min(focused, controls.length - 1);
  const buttons = useRef<(HTMLElement | null)[]>([]);
  const move = (index: number) => {
    const next = (index + controls.length) % controls.length;
    setFocused(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Keys pressed inside an open menu (portaled, but a React child)
    // belong to it.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "ArrowRight") move(focusIndex + 1);
    else if (event.key === "ArrowLeft") move(focusIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(controls.length - 1);
    else return;
    event.preventDefault();
  };
  const base =
    "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full text-foreground/75 transition-[background-color,color] duration-150 ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-disabled:opacity-40 data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground";
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className="flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-full border border-transparent bg-card px-1 py-1 shadow-(--shadow-border)"
    >
      {controls.map((control, index) => {
        const common = {
          tabIndex: index === focusIndex ? 0 : -1,
          // Keeps the editor's selection while clicking.
          onMouseDown: (e: { preventDefault: () => void }) =>
            e.preventDefault(),
          onFocus: () => setFocused(index),
        };
        const register = (node: HTMLElement | null) => {
          buttons.current[index] = node;
        };
        return (
          <span key={control.id} className="flex shrink-0 items-center">
            {control.separatorBefore && index > 0 && (
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            )}
            {control.kind === "button" ? (
              <button
                ref={register}
                type="button"
                {...common}
                aria-label={control.label}
                aria-pressed={control.pressed}
                title={
                  control.shortcut
                    ? `${control.label} (${control.shortcut})`
                    : control.label
                }
                // Unavailable controls stay focusable so the toolbar keeps
                // its tab stop and arrow order.
                aria-disabled={
                  disabled || control.disabled === true ? true : undefined
                }
                onClick={() => {
                  if (!disabled && control.disabled !== true) control.run();
                }}
                className={cn(
                  base,
                  "size-7",
                  control.pressed && "bg-foreground/8 text-foreground",
                )}
              >
                {control.icon}
              </button>
            ) : (
              <Popover
                width={control.width ?? 220}
                disabled={disabled}
                trigger={({ disabled: _closed, ref, ...props }) => (
                  <button
                    {...props}
                    ref={(node) => {
                      ref(node);
                      register(node);
                    }}
                    type="button"
                    {...common}
                    aria-label={control.label}
                    aria-disabled={disabled || undefined}
                    title={control.label}
                    className={cn(
                      base,
                      control.text ? "pr-1.5 pl-2 text-[13px]" : "size-7",
                      control.pressed && "bg-foreground/8 text-foreground",
                    )}
                  >
                    {control.icon}
                    {control.text && (
                      <>
                        <span className="max-w-24 truncate">
                          {control.text}
                        </span>
                        <ChevronDown
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                      </>
                    )}
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuTitle>{control.label}</MenuTitle>
                    {control.menu(close)}
                  </>
                )}
              </Popover>
            )}
          </span>
        );
      })}
    </div>
  );
}

function MenuTitle({ children }: { children: ReactNode }) {
  const labelId = usePopover()?.labelId;
  return (
    <h2 id={labelId} className="sr-only">
      {children}
    </h2>
  );
}

// A link on the selection (or the link around the caret): its address,
// applied with Enter; "Remove" unlinks the text and keeps it.
function LinkForm({
  editor,
  href: initial,
  linked,
  close,
}: {
  editor: Editor;
  href: string;
  linked: boolean;
  close: () => void;
}) {
  const id = useId();
  const [href, setHref] = useState(initial);
  const apply = () => {
    const value = href.trim();
    close();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const url = /^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(value)
      ? value
      : `https://${value}`;
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !linked)
      chain
        .insertContent({
          type: "text",
          text: value,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    else chain.setLink({ href: url }).run();
  };
  return (
    <form
      className="flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        apply();
      }}
    >
      <label htmlFor={id} className="text-xs font-medium">
        Link address
      </label>
      <input
        id={id}
        autoFocus
        type="text"
        inputMode="url"
        value={href}
        onChange={(e) => setHref(e.target.value)}
        placeholder="https://"
        className="h-8 w-full rounded-md border border-foreground/20 bg-background px-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 touch:text-base"
      />
      <div className="flex justify-end gap-1">
        {linked && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              close();
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
            }}
          >
            Remove link
          </Button>
        )}
        <Button type="submit" size="sm">
          {linked ? "Update" : "Add link"}
        </Button>
      </div>
    </form>
  );
}
