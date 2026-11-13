import type { ComponentProps, ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";

// Suggestion (AI Elements): a prompt the person sends without typing. A row
// that scrolls sideways when it does not fit (fading the edge with more to
// show), or wraps where there is room.
export function Suggestions({
  className,
  wrap,
  ...props
}: ComponentProps<"div"> & { wrap?: boolean }) {
  return (
    <div
      role="group"
      aria-label="Suggestions"
      className={cn(
        "flex min-w-0 gap-1.5",
        wrap
          ? "flex-wrap"
          : "scroll-fade-x [scrollbar-width:none] overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function Suggestion({
  icon,
  children,
  className,
  ...props
}: ComponentProps<"button"> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "group/suggestion inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 text-[12.5px] whitespace-nowrap text-foreground/90 shadow-[0_1px_2px_oklch(0_0_0/0.04)] transition-[background-color,border-color,color,scale] duration-150 outline-none hover:border-foreground/15 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97] [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground [&_svg]:transition-colors hover:[&_svg]:text-foreground",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
