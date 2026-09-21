import type { ButtonHTMLAttributes } from "react";

import { cn } from "~/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-[0_1px_2px_oklch(0_0_0/0.12),0_4px_12px_oklch(0.58_0.22_259/0.18)] hover:bg-primary/92",
        variant === "secondary" &&
          "bg-card text-card-foreground shadow-[var(--shadow-border)] hover:bg-accent hover:shadow-[var(--shadow-border-hover)]",
        variant === "danger" &&
          "bg-destructive text-destructive-foreground hover:bg-destructive/92",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
