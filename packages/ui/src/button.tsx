import type { ButtonHTMLAttributes } from "react";

import { cn } from "@lictory/core/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-7 px-2 text-xs",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-sm",
        size === "icon" && "size-7 text-xs",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.12),0_1px_1px_oklch(0_0_0/0.08)] hover:bg-primary/90",
        variant === "secondary" &&
          "bg-card text-foreground shadow-(--shadow-border) hover:bg-muted",
        variant === "outline" &&
          "border bg-transparent text-foreground hover:bg-muted",
        variant === "danger" &&
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
