"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import {
  Bold,
  Code2,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  PencilLine,
  Quote,
  Strikethrough,
} from "lucide-react";
import { Markdown } from "~/components/items/markdown";
import { cn } from "~/lib/utils";

type MarkdownEditorProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
  previewClassName?: string;
};

type Edit = { value: string; start: number; end: number };

export const MarkdownEditor = forwardRef<
  HTMLTextAreaElement,
  MarkdownEditorProps
>(function MarkdownEditor(
  {
    value,
    onValueChange,
    className,
    containerClassName,
    previewClassName,
    onKeyDown,
    disabled,
    rows = 4,
    ...props
  },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  useImperativeHandle(forwardedRef, () => textareaRef.current!, []);

  const commit = useCallback(
    (edit: Edit) => {
      onValueChange(edit.value);
      requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true });
        textareaRef.current?.setSelectionRange(edit.start, edit.end);
      });
    },
    [onValueChange],
  );

  const selection = () => ({
    start: textareaRef.current?.selectionStart ?? value.length,
    end: textareaRef.current?.selectionEnd ?? value.length,
  });

  const inline = (before: string, after = before, placeholder = "text") => {
    const { start, end } = selection();
    const selected = value.slice(start, end);
    if (
      selected &&
      value.slice(start - before.length, start) === before &&
      value.slice(end, end + after.length) === after
    ) {
      commit({
        value:
          value.slice(0, start - before.length) +
          selected +
          value.slice(end + after.length),
        start: start - before.length,
        end: end - before.length,
      });
      return;
    }
    const content = selected.length > 0 ? selected : placeholder;
    commit({
      value:
        value.slice(0, start) + before + content + after + value.slice(end),
      start: start + before.length,
      end: start + before.length + content.length,
    });
  };

  const prefixLines = (
    prefix: string,
    matcher: RegExp,
    replaceMatcher = matcher,
  ) => {
    const { start, end } = selection();
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const remove = lines.every((line) => !line.trim() || matcher.test(line));
    const changed = lines
      .map((line, index) => {
        matcher.lastIndex = 0;
        if (remove) return line.replace(matcher, "");
        if (!line && index === lines.length - 1) return line;
        return `${prefix}${line.replace(replaceMatcher, "")}`;
      })
      .join("\n");
    commit({
      value: value.slice(0, lineStart) + changed + value.slice(lineEnd),
      start: lineStart,
      end: lineStart + changed.length,
    });
  };

  const heading = (level: 1 | 2) =>
    prefixLines(
      `${"#".repeat(level)} `,
      new RegExp(`^#{${level}}\\s+`),
      /^#{1,6}\s+/,
    );

  const addLink = () => {
    const { start, end } = selection();
    const selected = value.slice(start, end);
    const label = selected.length > 0 ? selected : "link text";
    const insertion = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    commit({
      value: value.slice(0, start) + insertion + value.slice(end),
      start: urlStart,
      end: urlStart + "https://".length,
    });
  };

  const continueList = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (start !== end) return;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const match = /^(\s*)([-*+] |\d+\. |[-*+] \[[ xX]\] )(.*)$/.exec(
      value.slice(lineStart, start),
    );
    if (!match) return;
    event.preventDefault();
    if (!match[3]) {
      commit({
        value: value.slice(0, lineStart) + value.slice(start),
        start: lineStart,
        end: lineStart,
      });
      return;
    }
    let marker = match[2]!;
    const ordered = /^(\d+)\. $/.exec(marker);
    if (ordered) marker = `${Number(ordered[1]) + 1}. `;
    if (/^[-*+] \[[ xX]\] $/.test(marker)) marker = `${marker.slice(0, 3)} ] `;
    const insertion = `\n${match[1]}${marker}`;
    commit({
      value: value.slice(0, start) + insertion + value.slice(start),
      start: start + insertion.length,
      end: start + insertion.length,
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "b") {
      event.preventDefault();
      inline("**");
    } else if (command && event.key.toLowerCase() === "i") {
      event.preventDefault();
      inline("_");
    } else if (command && event.key.toLowerCase() === "k") {
      event.preventDefault();
      addLink();
    } else continueList(event);
  };

  const tools = [
    { label: "Heading 1", icon: Heading1, action: () => heading(1) },
    { label: "Heading 2", icon: Heading2, action: () => heading(2) },
    { label: "Bold (⌘B)", icon: Bold, action: () => inline("**") },
    { label: "Italic (⌘I)", icon: Italic, action: () => inline("_") },
    { label: "Strikethrough", icon: Strikethrough, action: () => inline("~~") },
    { label: "Inline code", icon: Code2, action: () => inline("`") },
    { label: "Link (⌘K)", icon: Link, action: addLink },
    {
      label: "Bulleted list",
      icon: List,
      action: () =>
        prefixLines(
          "- ",
          /^[-*+]\s+(?!\[[ xX]\]\s+)/,
          /^([-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/,
        ),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      action: () =>
        prefixLines(
          "1. ",
          /^\d+\.\s+/,
          /^([-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/,
        ),
    },
    {
      label: "Task list",
      icon: ListChecks,
      action: () =>
        prefixLines(
          "- [ ] ",
          /^[-*+]\s+\[[ xX]\]\s+/,
          /^([-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/,
        ),
    },
    { label: "Quote", icon: Quote, action: () => prefixLines("> ", /^>\s+/) },
  ];

  return (
    <div
      className={cn(
        "group/markdown relative rounded-md border bg-card focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10",
        disabled && "opacity-60",
        containerClassName,
      )}
    >
      {preview ? (
        <div
          className={cn(
            "min-h-28 overflow-auto px-3 pt-3 pb-14",
            previewClassName,
          )}
          onClick={() => setPreview(false)}
        >
          {value.trim() ? (
            <Markdown source={value} className="text-[13px] leading-6" />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Nothing to preview yet.
            </p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={rows}
          spellCheck
          className={cn(
            "min-h-28 w-full resize-y rounded-[inherit] bg-transparent px-3 pt-3 pb-14 text-[13px] leading-6 outline-none placeholder:text-muted-foreground/70",
            className,
          )}
          {...props}
        />
      )}
      <div
        role="toolbar"
        aria-label="Markdown formatting"
        className="absolute right-2 bottom-2 left-2 flex h-9 items-center rounded-lg bg-popover p-1 text-muted-foreground shadow-[var(--shadow-panel)]"
      >
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          <div className="flex min-w-max items-center">
            {tools.map(({ label, icon: Icon, action }, index) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                disabled={preview ? true : disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={action}
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md transition-[background-color,color,scale] duration-100 ease-out hover:bg-muted hover:text-foreground active:scale-96 disabled:pointer-events-none disabled:opacity-40",
                  (index === 2 || index === 7) && "ml-1 border-l pl-1",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </div>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <button
          type="button"
          title={preview ? "Continue writing" : "Preview Markdown"}
          aria-label={preview ? "Continue writing" : "Preview Markdown"}
          aria-pressed={preview}
          disabled={disabled}
          onClick={() => {
            setPreview((current) => !current);
            if (preview)
              requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          className={cn(
            "ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-[background-color,color,scale] duration-100 ease-out hover:bg-muted hover:text-foreground active:scale-96",
            preview && "bg-muted text-foreground",
          )}
        >
          {preview ? (
            <PencilLine className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Eye className="size-3.5" strokeWidth={1.75} />
          )}
          {preview ? "Write" : "Preview"}
        </button>
      </div>
    </div>
  );
});
