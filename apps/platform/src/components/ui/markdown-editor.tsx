import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
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
  Paperclip,
  List,
  ListChecks,
  ListOrdered,
  PencilLine,
  Quote,
  Strikethrough,
} from "lucide-react";
import { Markdown } from "@lictory/platform/components/items/markdown";
import {
  ACCEPT_FILES,
  fileMarkdown,
  uploadFile,
  type FileContext,
} from "@lictory/platform/components/items/file-upload";
import { Avatar } from "@lictory/ui/primitives";
import { cn } from "@lictory/core/lib/utils";
import { matchesPerson } from "@lictory/core/lib/handles";
import { mentionToken } from "@lictory/core/notifications/mentions";

export type Mentionable = {
  id: string;
  name: string;
  email?: string;
  handle?: string | null;
};

type MarkdownEditorProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  containerClassName?: string;
  previewClassName?: string;
  autoResize?: boolean;
  maxAutoHeight?: number;
  // People who can be @mentioned. Omit to disable mentions.
  mentions?: Mentionable[];
  fileContext?: FileContext;
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
    autoResize = false,
    maxAutoHeight = 320,
    onKeyDown,
    disabled,
    rows = 4,
    mentions,
    fileContext,
    onBlur,
    onPaste,
    ...props
  },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [preview, setPreview] = useState(false);
  // An @query being typed at the caret: where it starts and what it says.
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const matches =
    mention && mentions
      ? mentions
          .filter((m) => matchesPerson(m, mention.query))
          // Handle-prefix matches first: that is what people type after @.
          .sort(
            (a, b) =>
              Number(!a.handle?.startsWith(mention.query.toLowerCase())) -
              Number(!b.handle?.startsWith(mention.query.toLowerCase())),
          )
          .slice(0, 6)
      : [];
  const detectMention = (text: string, caret: number) => {
    if (!mentions?.length) return;
    const match = /(^|\s)@([^\s@\[\]()]{0,30})$/.exec(text.slice(0, caret));
    setMention(
      match ? { start: caret - match[2]!.length - 1, query: match[2]! } : null,
    );
    setMentionIndex(0);
  };
  useImperativeHandle(forwardedRef, () => textareaRef.current!, []);
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoResize) return;
    textarea.style.height = "auto";
    const height = Math.min(textarea.scrollHeight, maxAutoHeight);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxAutoHeight ? "auto" : "hidden";
  }, [autoResize, maxAutoHeight]);
  useLayoutEffect(() => {
    if (!preview) resize();
  }, [preview, resize, value]);

  // Caret to restore once the edited value has rendered. Applied in a layout
  // effect (not a later frame) so fast typing cannot land before it.
  const pendingSelection = useRef<Edit | null>(null);
  useLayoutEffect(() => {
    const edit = pendingSelection.current;
    const textarea = textareaRef.current;
    if (!edit || textarea?.value !== edit.value) return;
    pendingSelection.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(edit.start, edit.end);
  }, [value]);

  const commit = useCallback(
    (edit: Edit) => {
      pendingSelection.current = edit;
      valueRef.current = edit.value;
      onValueChange(edit.value);
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

  const addFiles = async (files: FileList | File[]) => {
    if (!fileContext || files.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      const snippets: string[] = [];
      for (const file of Array.from(files))
        snippets.push(fileMarkdown(await uploadFile(file, fileContext)));
      const { start, end } = selection();
      const insertion = snippets.join("\n");
      const latest = valueRef.current;
      commit({
        value: latest.slice(0, start) + insertion + latest.slice(end),
        start: start + insertion.length,
        end: start + insertion.length,
      });
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "File upload failed.",
      );
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
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

  const insertMention = (person: Mentionable) => {
    if (!mention) return;
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const token = `${mentionToken(person)} `;
    const next = value.slice(0, mention.start) + token + value.slice(caret);
    setMention(null);
    commit({
      value: next,
      start: mention.start + token.length,
      end: mention.start + token.length,
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMentionIndex((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        insertMention(matches[mentionIndex] ?? matches[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMention(null);
        return;
      }
    }
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
          onChange={(event) => {
            const linked = linkTypedHandle(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
              mentions,
            );
            if (linked) {
              setMention(null);
              commit(linked);
              return;
            }
            onValueChange(event.target.value);
            detectMention(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length,
            );
          }}
          onBlur={(event) => {
            setMention(null);
            onBlur?.(event);
          }}
          onKeyDown={handleKeyDown}
          onDragOver={
            fileContext ? (event) => event.preventDefault() : undefined
          }
          onPaste={(event) => {
            onPaste?.(event);
            if (
              event.defaultPrevented ||
              !fileContext ||
              !event.clipboardData.files.length
            )
              return;
            event.preventDefault();
            void addFiles(event.clipboardData.files);
          }}
          onDrop={
            fileContext
              ? (event) => {
                  event.preventDefault();
                  void addFiles(event.dataTransfer.files);
                }
              : undefined
          }
          disabled={disabled}
          rows={rows}
          spellCheck
          className={cn(
            "min-h-28 w-full resize-y rounded-[inherit] bg-transparent px-3 pt-3 pb-14 text-[13px] leading-6 outline-none placeholder:text-muted-foreground/70",
            autoResize && "resize-none overflow-y-hidden",
            className,
          )}
          {...props}
        />
      )}
      {mention && matches.length > 0 && !preview && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute right-2 bottom-12 left-2 z-20 max-w-72 overflow-hidden rounded-lg bg-popover p-1 shadow-(--shadow-panel)"
        >
          {matches.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === mentionIndex}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(m);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]",
                  i === mentionIndex && "bg-muted",
                )}
              >
                <Avatar userId={m.id} name={m.name} size="xs" />
                <span className="truncate">{m.name}</span>
                {(m.handle ?? m.email) && (
                  <span className="ml-auto truncate text-[11px] text-muted-foreground">
                    {m.handle ? `@${m.handle}` : m.email}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploadError && (
        <p role="alert" className="px-3 pb-12 text-xs text-destructive">
          {uploadError}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_FILES}
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
        }}
      />
      <div
        role="toolbar"
        aria-label="Markdown formatting"
        className="absolute right-2 bottom-2 left-2 flex h-9 items-center rounded-lg bg-popover p-1 text-muted-foreground shadow-(--shadow-panel)"
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
        {fileContext && (
          <button
            type="button"
            aria-label="Insert file or image"
            title="Insert file or image"
            disabled={Boolean(disabled) || uploading}
            onClick={() => fileInput.current?.click()}
            className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-muted disabled:opacity-50"
          >
            <Paperclip className="size-3.5" />
          </button>
        )}
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

// Typing "@handle" followed by a space or punctuation links it to that person,
// so a mention works without picking from the list.
function linkTypedHandle(
  text: string,
  caret: number,
  mentions: Mentionable[] | undefined,
): Edit | null {
  if (!mentions?.length) return null;
  const match = /(^|\s)@([A-Za-z0-9_]{3,30})([\s.,;:!?)])$/.exec(
    text.slice(0, caret),
  );
  if (!match) return null;
  const person = mentions.find(
    (m) => m.handle && m.handle === match[2]!.toLowerCase(),
  );
  if (!person) return null;
  const start = caret - match[2]!.length - match[3]!.length - 1;
  const token = mentionToken(person) + match[3]!;
  return {
    value: text.slice(0, start) + token + text.slice(caret),
    start: start + token.length,
    end: start + token.length,
  };
}
