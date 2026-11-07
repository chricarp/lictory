import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@lictory/core/lib/utils";
import { keepTabInside } from "@lictory/platform/components/spaces/dialog";

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
        "outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
      )}
    >
      {content}
    </button>
  ) : (
    <blockquote className={className}>{content}</blockquote>
  );
}

// "2 open · 1 blocking", neutral, with a small red marker for blocking.
export function DiscussionCounts({
  open,
  blocking,
}: {
  open: number;
  blocking: number;
}) {
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {open} open
      {blocking ? (
        <>
          <span className="sr-only">, </span>
          <span className="ml-2 inline-flex items-center gap-1 font-medium text-foreground">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-destructive/80"
            />
            {blocking} blocking
          </span>
        </>
      ) : null}
    </span>
  );
}

// The panel on narrow frames: a modal sheet from the bottom. It takes focus
// when it opens, keeps Tab inside, closes with Escape and returns focus to
// what opened it.
export function DiscussionSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The caller passes a new function each render; the sheet must not move
  // focus on re-renders (a remote reply would pull focus out of a composer).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    // Escape that a control inside the sheet already handled (a picker
    // closing, a composer cancelling) is not also a request to close the
    // sheet, which would discard what the person typed.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Tab bubbles from the sheet's controls; keeping it inside is the modal dialog pattern. */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (ref.current) keepTabInside(event, ref.current);
        }}
        className="relative max-h-[85dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl bg-background px-4 pb-4 shadow-(--shadow-panel) outline-none"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
