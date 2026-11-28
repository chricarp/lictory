import { useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { CHANNEL_MESSAGE_MAX } from "@lictory/core/channels/shared";
import { Button } from "@lictory/ui/button";
import { canWrite } from "@lictory/platform/data/connection";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
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
// composer by its draft key). The Factory's steering composer is this one
// too, without a channel (no files) and without references.

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
  onTyping,
  references = true,
  hint = "Enter to send · Shift+Enter for a new line · @ to mention · # for work items",
  maxLength = CHANNEL_MESSAGE_MAX,
  className,
}: {
  draftKey: string;
  organizationId: string;
  // Files attach to the channel's messages; without one, no files.
  channelId?: string;
  placeholder: string;
  mentions: Mentionable[];
  disabled?: boolean;
  disabledReason?: string;
  onSend: (body: string) => void;
  onEditLast?: () => boolean;
  onEscape?: () => void;
  // Called while the person writes (typing indicators).
  onTyping?: () => void;
  autoFocus?: boolean;
  label: string;
  // "#" work items, "[[" pages and decisions (default on).
  references?: boolean;
  // The line under the field; the chat keys by default.
  hint?: string;
  // The longest message the field accepts.
  maxLength?: number;
  className?: string;
}) {
  const [body, setBody] = useState(() => drafts.get(draftKey) ?? "");
  const editor = useRef<MarkdownEditorHandle>(null);
  const change = (value: string) => {
    if (value.trim() && value !== body) onTyping?.();
    setBody(value);
    if (value.trim()) drafts.set(draftKey, value);
    else drafts.delete(draftKey);
  };
  const tooLong = body.length > maxLength;
  // While the connection is down the person can keep writing; a message sent
  // during a reconnect waits in this tab and is delivered once it is back,
  // and with no connection at all sending waits until there is one.
  const { connection, everConnected } = useWorkspace();
  const offline = !canWrite(connection);
  const reconnecting = connection === "connecting" && everConnected;
  const connectionNote = offline
    ? "You’re offline. Your message stays here until you can send it."
    : reconnecting
      ? "Reconnecting… Messages send once reconnected."
      : undefined;
  const send = () => {
    const text = body.trim();
    if (!text || tooLong || disabled || offline) return;
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
      <div
        className={cn(
          "mx-3 mb-3 rounded-xl border bg-muted/40 px-4 py-3 text-center text-[13px] text-muted-foreground sm:mx-4",
          className,
        )}
      >
        {disabledReason}
      </div>
    );
  return (
    <div
      className={cn("mx-3 mb-3 sm:mx-4", className)}
      onKeyDownCapture={onKeyDownCapture}
      data-composer={draftKey}
    >
      <div
        className={cn(
          "flex items-end gap-1 rounded-xl border border-input bg-card pr-1.5 pb-1.5 shadow-xs transition-shadow focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/10",
          tooLong && "ring-2 ring-destructive/40",
        )}
      >
        <div className="min-w-0 flex-1">
          <MarkdownEditor
            ref={editor}
            value={body}
            onValueChange={change}
            mentions={mentions}
            fileContext={channelId ? { organizationId, channelId } : undefined}
            references={references}
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
          disabled={!body.trim() || tooLong || Boolean(disabled) || offline}
          onClick={send}
        >
          <SendHorizontal className="size-3.5" aria-hidden />
        </Button>
      </div>
      <p
        data-connection-note={connectionNote ? "" : undefined}
        className={cn(
          "mt-1 hidden px-1 text-xs text-muted-foreground sm:block",
          tooLong && "block text-destructive",
          !tooLong && connectionNote && "block text-warning",
        )}
      >
        {tooLong
          ? `At most ${maxLength.toLocaleString()} characters. Put longer text in a page.`
          : (connectionNote ?? hint)}
      </p>
    </div>
  );
}
