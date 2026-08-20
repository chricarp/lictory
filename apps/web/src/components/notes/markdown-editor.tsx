"use client";

import {
  Bold,
  Code,
  Eye,
  Heading,
  Italic,
  Link2,
  List,
  ListOrdered,
  PenLine,
  Quote,
  Strikethrough,
} from "@/components/ui/icons";
import * as React from "react";

import { Markdown } from "@/components/notes/markdown";
import {
  KEYBINDINGS,
  Keybinding,
  keybindingAria,
  matchesKeybinding,
  type KeybindingDefinition,
} from "@/components/ui/keybinding";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Wrap = {
  icon: typeof Bold;
  label: string;
  before: string;
  after?: string;
  /** Applies to the whole line rather than the selection. */
  linePrefix?: boolean;
  shortcut?: KeybindingDefinition;
};

const ACTIONS: Wrap[] = [
  {
    icon: Bold,
    label: "Bold",
    before: "**",
    after: "**",
    shortcut: KEYBINDINGS.bold,
  },
  {
    icon: Italic,
    label: "Italic",
    before: "_",
    after: "_",
    shortcut: KEYBINDINGS.italic,
  },
  { icon: Strikethrough, label: "Strikethrough", before: "~~", after: "~~" },
  { icon: Heading, label: "Heading", before: "## ", linePrefix: true },
  { icon: Quote, label: "Quote", before: "> ", linePrefix: true },
  { icon: List, label: "Bulleted list", before: "- ", linePrefix: true },
  {
    icon: ListOrdered,
    label: "Numbered list",
    before: "1. ",
    linePrefix: true,
  },
  { icon: Code, label: "Code", before: "`", after: "`" },
  {
    icon: Link2,
    label: "Link",
    before: "[",
    after: "](url)",
    shortcut: KEYBINDINGS.link,
  },
];

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyState?: React.ReactNode;
  floatingToolbar?: React.ReactNode;
  overlay?: React.ReactNode;
  minRows?: number;
  className?: string;
  autoFocus?: boolean;
  onFilesDropped?: (files: File[]) => void;
};

/**
 * A GitHub-style lightweight Markdown editor: a plain textarea with a small
 * formatting toolbar and a preview tab. Deliberately not a rich-text/WYSIWYG
 * surface — the stored value stays clean Markdown, keyboard behaviour stays
 * native, and there is no editor framework in the bundle.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "What happened? Write it however you like — Markdown works.",
  emptyState,
  floatingToolbar,
  overlay,
  minRows = 6,
  className,
  autoFocus,
  onFilesDropped,
}: MarkdownEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [dragging, setDragging] = React.useState(false);

  const applyWrap = React.useCallback(
    (action: Wrap) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const { selectionStart, selectionEnd } = textarea;

      if (action.linePrefix) {
        const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const next = `${value.slice(0, lineStart)}${action.before}${value.slice(lineStart)}`;
        onChange(next);
        requestAnimationFrame(() => {
          textarea.focus();
          const offset = action.before.length;
          textarea.setSelectionRange(
            selectionStart + offset,
            selectionEnd + offset,
          );
        });
        return;
      }

      const selected = value.slice(selectionStart, selectionEnd);
      const after = action.after ?? action.before;
      const next =
        value.slice(0, selectionStart) +
        action.before +
        selected +
        after +
        value.slice(selectionEnd);
      onChange(next);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(
          selectionStart + action.before.length,
          selectionEnd + action.before.length,
        );
      });
    },
    [value, onChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const action = ACTIONS.find(
      (item) =>
        item.shortcut && matchesKeybinding(event.nativeEvent, item.shortcut),
    );
    if (!action) return;
    event.preventDefault();
    applyWrap(action);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-hairline-strong bg-[rgb(var(--surface)/0.04)] transition-colors",
        "focus-within:border-[rgb(var(--ember)/0.45)]",
        dragging &&
          "border-[rgb(var(--ember)/0.7)] bg-[rgb(var(--ember)/0.06)]",
        className,
      )}
      onDragOver={(event) => {
        if (!onFilesDropped) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (!onFilesDropped) return;
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFilesDropped(files);
      }}
    >
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ACTIONS.map((action) => (
            <Hint
              key={action.label}
              label={
                <span className="flex items-center gap-2">
                  {action.label}
                  {action.shortcut ? (
                    <Keybinding binding={action.shortcut} />
                  ) : null}
                </span>
              }
            >
              <button
                type="button"
                onClick={() => applyWrap(action)}
                disabled={mode === "preview"}
                aria-keyshortcuts={
                  action.shortcut ? keybindingAria(action.shortcut) : undefined
                }
                className="rounded-lg p-1.5 text-subtle transition-colors hover:bg-surface-strong hover:text-foreground disabled:opacity-30"
              >
                <action.icon className="size-3.5" />
                <span className="sr-only">{action.label}</span>
              </button>
            </Hint>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-hairline p-0.5">
          {(["write", "preview"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem] font-medium capitalize transition-colors",
                mode === item
                  ? "bg-surface-strong text-foreground"
                  : "text-subtle hover:text-foreground",
              )}
            >
              {item === "write" ? (
                <PenLine className="size-3" />
              ) : (
                <Eye className="size-3" />
              )}
              {item}
            </button>
          ))}
        </div>
      </div>

      {mode === "write" ? (
        <div className="relative">
          {value.length === 0 && emptyState && !overlay ? (
            <div className="pointer-events-none absolute inset-x-5 top-6 text-sm leading-6 text-subtle">
              {emptyState}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={value}
            autoFocus={autoFocus}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              if (!onFilesDropped) return;
              const files = Array.from(event.clipboardData.files);
              if (files.length) onFilesDropped(files);
            }}
            placeholder={emptyState ? undefined : placeholder}
            rows={minRows}
            className="relative z-0 w-full resize-y bg-transparent px-5 pb-20 pt-5 font-sans text-base leading-7 text-foreground outline-none placeholder:text-subtle"
          />
          {overlay ? (
            <div className="absolute inset-0 z-10 overflow-hidden bg-canvas-raised">
              {overlay}
            </div>
          ) : null}
          {floatingToolbar ? (
            <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-center">
              {floatingToolbar}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-32 px-4 py-3.5">
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-sm text-subtle">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
