"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@lictory/core/lib/utils";

// Hover/focus label for icon-only controls. Portaled so list rows do not clip it.
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number>(undefined);
  const [position, setPosition] = useState<{ top: number; left: number }>();

  const show = () => {
    window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setOpen(true), 100);
  };
  const hide = () => {
    window.clearTimeout(showTimer.current);
    setOpen(false);
  };

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const gap = 6;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let top = anchor.top - gap - height;
      if (top < 8) top = anchor.bottom + gap;
      const left = Math.min(
        Math.max(8, anchor.left + anchor.width / 2 - width / 2),
        window.innerWidth - width - 8,
      );
      setPosition({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, label]);

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
        onPointerDown={hide}
      >
        {children}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="tooltip"
            aria-hidden
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
            }}
            className={cn(
              "fixed z-50 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-(--shadow-panel)",
              position ? "animate-in" : "invisible",
            )}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
