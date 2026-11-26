import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog, DialogBackdrop, DialogContent } from "@ui-sdk/react/dialog";
import { popupContainer } from "@lictory/ui/popup";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Presentation shared by the discussions beside pages and beside
// specifications: the quoted passage, the sheet that holds the panel on
// narrow frames and the counts in its header. Each side keeps its own
// rules (who may comment, what blocking holds back, how anchors resolve).

// The commented passage, drawn with the tint its text has in the document
// (a quote whose text is no longer on screen stays neutral and italic).
export function QuoteBlock({
  quote,
  muted,
  blocking,
  onClick,
  title = "Show in the page",
}: {
  quote: string;
  muted?: boolean;
  blocking?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const content = <span className="line-clamp-4 text-left">{quote}</span>;
  const className = cn(
    "block w-full rounded-r-md border-l-2 px-2.5 py-1 text-[13px] leading-5 text-foreground/80",
    muted
      ? "border-foreground/15 bg-muted/60 text-muted-foreground italic"
      : blocking
        ? "border-destructive/50 bg-destructive/6"
        : "border-warning/60 bg-warning/8",
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        className,
        "flex items-center outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 touch:min-h-11",
      )}
    >
      {content}
    </button>
  ) : (
    <blockquote className={className}>{content}</blockquote>
  );
}

// "2 open · 1 blocking", neutral, with a small red marker for blocking.
// With `onBlocking`, the blocking count is a button that goes to the next
// blocking discussion.
export function DiscussionCounts({
  open,
  blocking,
  onBlocking,
}: {
  open: number;
  blocking: number;
  onBlocking?: () => void;
}) {
  const marker = (
    <>
      <span aria-hidden className="size-1.5 rounded-full bg-destructive/80" />
      {blocking} blocking
    </>
  );
  return (
    <span className="flex min-w-0 shrink-0 items-center text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {open} open
      {blocking ? (
        <>
          <span className="sr-only">, </span>
          {onBlocking ? (
            <button
              type="button"
              onClick={onBlocking}
              title="Go to the next blocking discussion"
              className="ml-1 inline-flex h-6 items-center gap-1 rounded-full px-1.5 font-medium text-foreground outline-none hover:bg-destructive/8 focus-visible:ring-2 focus-visible:ring-ring/60 touch:h-11"
            >
              {marker}
            </button>
          ) : (
            <span className="ml-2 inline-flex items-center gap-1 font-medium text-foreground">
              {marker}
            </span>
          )}
        </>
      ) : null}
    </span>
  );
}

// Says something to screen readers without moving focus (a reply sent, a
// discussion resolved). One polite region for the whole page.
let region: HTMLElement | null = null;
export function announce(message: string) {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    region.className = "sr-only";
    document.body.append(region);
  }
  const target = region;
  target.textContent = "";
  window.setTimeout(() => {
    target.textContent = message;
  }, 50);
}

// A comment being written, kept until it is sent or discarded: it outlives
// the field (closing a panel or sheet unmounts it) and, in this tab, a
// reload. Keys name the person writing (so signing out, which forgets
// session entries naming the account, forgets their drafts and nobody else
// in the tab sees them), the item and what the text answers.
const drafts = new Map<string, string>();
const draftStorage = "lictory:discussion-draft:";
function readDraft(key: string) {
  const known = drafts.get(key);
  if (known !== undefined) return known;
  try {
    return sessionStorage.getItem(draftStorage + key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string, value: string) {
  if (value) drafts.set(key, value);
  else drafts.delete(key);
  try {
    if (value) sessionStorage.setItem(draftStorage + key, value);
    else sessionStorage.removeItem(draftStorage + key);
  } catch {
    // Private windows: the draft lasts while the page is open.
  }
}
export function useStoredDraft(draft: string) {
  const { userId } = useWorkspace();
  const key = `${userId}:${draft}`;
  const [value, setValue] = useState(() => readDraft(key));
  const [shownKey, setShownKey] = useState(key);
  // Another item (or thread) in the same field: show its draft.
  if (shownKey !== key) {
    setShownKey(key);
    setValue(readDraft(key));
  }
  const set = useCallback(
    (next: string) => {
      writeDraft(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set] as const;
}

// The panel on narrow frames (phones): a modal sheet from the bottom, never
// taller than 60% of the screen and over a light scrim, so the title and the
// text above it stay readable. Wider frames dock the panel beside the text
// instead (the item page from ~664px). It takes focus
// when it opens, keeps Tab inside, closes with Escape (unless a control inside
// handled the key and prevented its default) and returns focus to what opened
// it.
export function DiscussionSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // The caller unmounts the sheet to close it, before it can hand focus back.
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    },
    [opener],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      container={popupContainer()}
    >
      <DialogBackdrop className="fixed inset-0 z-50 bg-black/15" />
      <DialogContent
        ref={panel}
        aria-label={label}
        // A composer that took focus while the sheet opened keeps it.
        initialFocus={() =>
          panel.current?.contains(document.activeElement)
            ? (document.activeElement as HTMLElement)
            : panel.current
        }
        className="fixed inset-x-0 top-auto bottom-0 z-50 mx-auto my-0 block max-h-[60dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none border-0 bg-background px-4 pt-0 pb-4 text-base text-foreground shadow-(--shadow-panel) outline-none"
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
