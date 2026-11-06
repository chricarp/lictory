import type { ReactNode } from "react";

import { cn } from "@lictory/core/lib/utils";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import type { CtaTracking } from "@lictory/marketing/lib/cta-analytics";

const linkBase =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]";

export function CtaLink({
  href,
  tracking,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  tracking: CtaTracking;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <TrackedLink
      href={href}
      tracking={tracking}
      className={cn(
        linkBase,
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_1px_rgb(0_0_0/0.08)] hover:bg-primary/90",
        variant === "secondary" &&
          "bg-card text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)] hover:bg-muted",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {children}
    </TrackedLink>
  );
}
