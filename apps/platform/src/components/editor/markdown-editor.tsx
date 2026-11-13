import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import { cn } from "@lictory/core/lib/utils";
import type { FileContext } from "@lictory/platform/components/items/file-upload";
import type { Mentionable } from "@lictory/platform/components/editor/commands";
import type RichMarkdownEditor from "@lictory/platform/components/editor/rich-markdown-editor";

export type { Mentionable };

// Every Markdown field in Work (specifications, branch drafts, descriptions,
// discussions, replies, decisions) uses this editor: the same rich editor as
// pages, storing Markdown. It loads in its own chunk on first use; until
// then (or if that code cannot load) a plain Markdown field bound to the
// same value stands in, so nothing typed is lost.
//
// `references` and `ref.focus()` work in both; the rich editor's own API
// lives in rich-markdown-editor.tsx.

export type MarkdownEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  placeholder?: string;
  // People who can be @mentioned (`@[label](mention:USER_ID)`). Omit to
  // disable mentions.
  mentions?: Mentionable[];
  // Where uploaded files belong; omit to disable files.
  fileContext?: FileContext;
  // Mod+Enter (submits a form, saves a revision).
  onSubmit?: () => void;
  // Escape while no picker is open.
  onEscape?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  // Comment composers: smaller text, the toolbar below the text.
  compact?: boolean;
  // Compact composers at rest (a one-line "Reply…" or "Start a
  // discussion" field) hide their toolbar until someone writes.
  toolbar?: boolean;
  // CSS lengths for the writing area; it grows up to `maxHeight`.
  minHeight?: string;
  maxHeight?: string;
  // The document element and the frame around editor and toolbar.
  className?: string;
  containerClassName?: string;
  // "#", "[[" and decision pickers (default on).
  references?: boolean;
};

export type MarkdownEditorHandle = { focus: () => void };

type RichEditor = typeof RichMarkdownEditor;
let loaded: RichEditor | null = null;
let loading: Promise<RichEditor> | null = null;
function loadRichEditor() {
  loading ??= import("@lictory/platform/components/editor/rich-markdown-editor")
    .then((m) => (loaded = m.default))
    .catch((error: unknown) => {
      // Offline or a failed deploy: try again on the next interaction.
      loading = null;
      throw error;
    });
  return loading;
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(props, ref) {
  const fallback = useRef<HTMLTextAreaElement>(null);
  const rich = useRef<MarkdownEditorHandle>(null);
  const [Rich, setRich] = useState<RichEditor | null>(() => loaded);
  // Fields people write in right away load the editor at once; comment
  // composers, which a page shows whether or not anyone comments, load it
  // when they are pointed at or focused, so reading never pays for it.
  const eager =
    !props.compact || Boolean(props.autoFocus) || props.value.trim() !== "";
  const activate = () => {
    if (!Rich)
      void loadRichEditor()
        .then((editor) => setRich(() => editor))
        // The plain field keeps working when the editor cannot load.
        .catch(() => undefined);
  };
  useEffect(() => {
    if (eager && !Rich)
      void loadRichEditor()
        .then((editor) => setRich(() => editor))
        .catch(() => undefined);
  }, [eager, Rich]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () =>
        rich.current ? rich.current.focus() : fallback.current?.focus(),
    }),
    [],
  );
  if (!Rich)
    return (
      <PlainMarkdownField {...props} ref={fallback} onActivate={activate} />
    );
  return (
    <FocusHandoff Rich={Rich} fallback={fallback} rich={rich} {...props} />
  );
});

// When the rich editor replaces a focused stand-in, focus (and the caret at
// the end) moves with it.
function FocusHandoff({
  Rich,
  fallback,
  rich,
  ...props
}: MarkdownEditorProps & {
  Rich: RichEditor;
  fallback: RefObject<HTMLTextAreaElement | null>;
  rich: RefObject<MarkdownEditorHandle | null>;
}) {
  const [hadFocus] = useState(
    () =>
      typeof document !== "undefined" &&
      fallback.current !== null &&
      document.activeElement === fallback.current,
  );
  useEffect(() => {
    if (hadFocus) rich.current?.focus();
  }, [hadFocus, rich]);
  return <Rich {...props} ref={rich} />;
}

const PlainMarkdownField = forwardRef<
  HTMLTextAreaElement,
  MarkdownEditorProps & { onActivate: () => void }
>(function PlainMarkdownField(
  {
    onActivate,
    value,
    onValueChange,
    id,
    placeholder,
    onSubmit,
    onEscape,
    onBlur,
    disabled,
    autoFocus,
    compact,
    toolbar = true,
    minHeight,
    maxHeight,
    containerClassName,
    ...props
  },
  ref,
) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10",
        containerClassName,
      )}
    >
      {!compact && <div aria-hidden className="h-9 border-b" />}
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape" && onEscape) {
            // Handled: an enclosing dialog must not also close.
            e.preventDefault();
            onEscape();
          }
        }}
        onBlur={onBlur}
        onFocus={onActivate}
        onPointerEnter={onActivate}
        disabled={disabled}
        autoFocus={autoFocus}
        // Height comes from minHeight (one line for a composer at rest).
        rows={1}
        placeholder={placeholder}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        spellCheck
        style={{
          minHeight: minHeight ?? (compact ? "4.5rem" : "8rem"),
          maxHeight,
        }}
        className={cn(
          "block w-full resize-none bg-transparent outline-none placeholder:text-muted-foreground/70 touch:text-base",
          compact
            ? "px-3 pt-2.5 pb-2 text-[13px] leading-6"
            : "px-4 py-3 text-[15px] leading-7",
        )}
      />
      {compact && toolbar && <div aria-hidden className="h-9 border-t" />}
    </div>
  );
});
