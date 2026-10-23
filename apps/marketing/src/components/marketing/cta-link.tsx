import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@lictory/core/lib/utils";

const linkBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]";

export function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        linkBase,
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" &&
          "bg-foreground text-background shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_8px_30px_-8px_oklch(0.75_0.12_285/0.55)] hover:bg-foreground/90",
        variant === "secondary" &&
          "bg-white/4 text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)] hover:bg-white/8",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-white/5 hover:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
