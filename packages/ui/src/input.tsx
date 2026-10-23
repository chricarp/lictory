import type { InputHTMLAttributes } from "react";

import { cn } from "@lictory/core/lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-input bg-card px-3.5 text-[15px] shadow-[0_1px_2px_oklch(0_0_0/0.03)] transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 touch:text-base",
        className,
      )}
      {...props}
    />
  );
}
