import { useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { CHANNEL_MESSAGE_MAX } from "@lictory/core/channels/shared";
import { Button } from "@lictory/ui/button";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
  type Mentionable,
} from "@lictory/platform/components/editor/markdown-editor";

// The message composer: the shared rich Markdown editor (mentions, work
// item, page and decision references, files and images pasted or dropped,
// Markdown source view), with chat keys: Enter sends, Shift+Enter breaks the
// line, ↑ in an empty composer edits your last message, Escape leaves.
// Unsent text is kept per conversation in this tab (callers key the
// composer by its draft key).

const drafts = new Map<string, string>();

export function Composer({
  draftKey,
  organizationId,
  channelId,
  placeholder,
  mentions,
  disabled,
  disabledReason,
  onSend,
  onEditLast,
  onEscape,
  autoFocus,
  label,
}: {
  draftKey: string;
  organizationId: string;
  channelId: string;
  placeholder: string;
  mentions: Mentionable[];
  disabled?: boolean;
  disabledReason?: string;
  onSend: (body: string) => void;
  onEditLast?: () => boolean;
  onEscape?: () => void;
  autoFocus?: boolean;
  label: string;
}) {
  const [body, setBody] = useState(() => drafts.get(draftKey) ?? "");
  const editor = useRef<MarkdownEditorHandle>(null);
  const change = (value: string) => {
    setBody(value);
    if (value.trim()) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };
  const tooLong = body.length > CHANNEL_MESSAGE_MAX;
  const send = () => {
    const text = body.trim();
    if (!text || tooLong || disabled) return;
    onSend(text);
    change("");
    requestAnimationFrame(() => editor.current?.focus());
  };
  // ↑ in an empty composer edits the last message you sent.
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (
      e.key === "ArrowUp" &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !body.trim() &&
      onEditLast?.()
    )
      e.preventDefault();
  };
  if (disabled && disabledReason)
    return (
      <div className="mx-3 mb-3 rounded-xl border bg-muted/40 px-4 py-3 text-center text-[13px] text-muted-foreground sm:mx-4">
        {disabledReason}
      </div>
    );
  return (
    <div
      className="mx-3 mb-3 sm:mx-4"
      onKeyDownCapture={onKeyDownCapture}
      data-composer={draftKey}
    >
      <div
        className={cn(
          "flex items-end gap-1 rounded-xl border bg-card pr-1.5 pb-1.5 shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-primary/25",
          tooLong && "ring-2 ring-destructive/40",
        )}
      >
        <div className="min-w-0 flex-1">
          <MarkdownEditor
            ref={editor}
            value={body}
            onValueChange={change}
            mentions={mentions}
            fileContext={{ organizationId, channelId }}
            onSubmit={send}
            onEscape={onEscape}
            enterSubmits
            compact
            autoFocus={autoFocus}
            disabled={disabled}
            minHeight="1.5rem"
            maxHeight="16rem"
            placeholder={placeholder}
            aria-label={label}
            containerClassName="rounded-xl border-0 bg-transparent ring-0 focus-within:border-transparent focus-within:ring-0"
          />
        </div>
        <Button
          size="icon"
          aria-label="Send message"
          disabled={!body.trim() || tooLong || disabled}
          onClick={send}
        >
          <SendHorizontal className="size-3.5" aria-hidden />
        </Button>
      </div>
      <p className="mt-1 hidden px-1 text-[11px] text-muted-foreground sm:block">
        {tooLong
          ? `Messages are at most ${CHANNEL_MESSAGE_MAX.toLocaleString()} characters; put longer text in a page.`
          : "Enter to send · Shift+Enter for a new line · @ to mention · # for work items"}
      </p>
    </div>
  );
}
