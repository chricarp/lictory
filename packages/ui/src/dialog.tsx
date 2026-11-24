"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Dialog as DialogPrimitive,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { X } from "lucide-react";
import { popupContainer } from "@lictory/ui/popup";
import { cn } from "@lictory/core/lib/utils";

export const dialogBackdropClass =
  "fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0";

export const dialogPanelClass =
  "fixed inset-x-0 top-[10vh] z-50 mx-auto my-0 flex max-h-[calc(100dvh-10vh-1rem)] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-xl border bg-popover p-0 text-popover-foreground shadow-(--shadow-panel) outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";

// A modal dialog: focus moves in on open (to `[data-autofocus]`, or the first
// control), Tab stays inside, Escape and a press outside close it, and focus
// returns to whatever opened it. It is open while it is rendered.
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  onSubmit,
  width = "max-w-lg",
  className,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // Renders the dialog as a form; Enter in a field submits.
  onSubmit?: () => void;
  width?: string;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Callers unmount the dialog to close it, before it can hand focus back.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    },
    [opener],
  );
  const body = (
    <>
      <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <DialogTitle className="m-0 text-sm font-semibold">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="mt-1 mb-0 text-[13px] leading-5 text-muted-foreground">
              {description}
            </DialogDescription>
          )}
        </div>
        <DialogClose
          aria-label="Close"
          className="rounded-md bg-transparent p-1 text-muted-foreground focus-ring outline-none hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </DialogClose>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {footer}
        </div>
      )}
    </>
  );
  return (
    <DialogPrimitive
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      container={popupContainer()}
    >
      <DialogBackdrop className={dialogBackdropClass} />
      <DialogContent
        ref={panel}
        initialFocus={() =>
          panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
          panel.current?.querySelector<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )
        }
        className={cn(dialogPanelClass, width, className)}
      >
        {onSubmit ? (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </DialogContent>
    </DialogPrimitive>
  );
}
