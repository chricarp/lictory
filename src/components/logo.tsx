import Link from "next/link";

import { cn } from "~/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-lg text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span className="grid size-8 place-items-center rounded-[10px] bg-foreground text-sm font-bold text-background shadow-sm">
        L
      </span>
      Lictory
    </Link>
  );
}
