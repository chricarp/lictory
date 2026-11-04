import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@lictory/core/lib/utils";

const linkBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]";

export function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "brand" | "secondary" | "ghost";
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
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_1px_rgb(0_0_0/0.08)] hover:bg-primary/90",
        variant === "brand" &&
          "bg-brand text-brand-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.12),0_8px_20px_-8px_color-mix(in_srgb,var(--brand)_70%,transparent)] hover:bg-brand/92",
        variant === "secondary" &&
          "bg-card text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)] hover:bg-muted",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
