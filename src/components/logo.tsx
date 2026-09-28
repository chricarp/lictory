import Link from "next/link";

import { cn } from "~/lib/utils";

/**
 * Two nested review brackets form an L: perspectives aligning around a spec.
 * Keep the geometry in sync with public/brand/lictory-mark.svg and app/icon.svg.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
    >
      <path d="M3 3h6v18a2 2 0 0 0 2 2h18v6H11a8 8 0 0 1-8-8V3Z" />
      <path d="M15 3h6v10a2 2 0 0 0 2 2h6v6h-6a8 8 0 0 1-8-8V3Z" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Lictory home"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-lg text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <LogoMark />
      lictory
    </Link>
  );
}
