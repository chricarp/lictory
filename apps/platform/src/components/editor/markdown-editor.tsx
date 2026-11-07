import {
  forwardRef,
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from "react";
import { cn } from "@lictory/core/lib/utils";
import type { FileContext } from "@lictory/platform/components/items/file-upload";
import type { Mentionable } from "@lictory/platform/components/editor/commands";

export type { Mentionable };

// Every Markdown field in Work (specifications, branch drafts, descriptions,
// discussions, replies, decisions) uses this editor: the same rich editor as
// pages, storing Markdown. It loads in its own chunk on first use; until
// then (or if that code cannot load) a plain Markdown field bound to the
// same value stands in, so nothing typed is lost.

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

export const loadRichMarkdownEditor = () =>
  import("@lictory/platform/components/editor/rich-markdown-editor");
const RichMarkdownEditor = lazy(loadRichMarkdownEditor);

export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function MarkdownEditor(props, ref) {
  const fallback = useRef<HTMLTextAreaElement>(null);
  const rich = useRef<MarkdownEditorHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () =>
        rich.current ? rich.current.focus() : fallback.current?.focus(),
    }),
    [],
  );
  return (
    <Suspense fallback={<PlainMarkdownField {...props} ref={fallback} />}>
      <FocusHandoff fallback={fallback} rich={rich} {...props} />
    </Suspense>
  );
});

// When the rich editor replaces a focused stand-in, focus moves with it.
function FocusHandoff({
  fallback,
  rich,
  ...props
}: MarkdownEditorProps & {
  fallback: RefObject<HTMLTextAreaElement | null>;
  rich: RefObject<MarkdownEditorHandle | null>;
}) {
  const hadFocus = useRef(
    typeof document !== "undefined" &&
      fallback.current !== null &&
      document.activeElement === fallback.current,
  );
  useEffect(() => {
    if (hadFocus.current) rich.current?.focus();
  }, [rich]);
  return <RichMarkdownEditor {...props} ref={rich} />;
}

const PlainMarkdownField = forwardRef<HTMLTextAreaElement, MarkdownEditorProps>(
  function PlainMarkdownField(
    {
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
            } else if (e.key === "Escape" && onEscape) onEscape();
          }}
          onBlur={onBlur}
          disabled={disabled}
          autoFocus={autoFocus}
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
        {compact && <div aria-hidden className="h-9 border-t" />}
      </div>
    );
  },
);
