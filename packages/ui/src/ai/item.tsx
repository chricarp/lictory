import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Item (shadcn/ui, MIT): a row of media, content and actions. Litto uses it
// for everything that waits for the person (a confirmation, a
// recommendation) and for errors, so prompts look different from steps.

const itemVariant = {
  default: "border-transparent",
  outline: "border-border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04)]",
  muted: "border-transparent bg-muted/50",
  attention:
    "border-[color-mix(in_oklch,var(--warning)_35%,var(--border))] bg-card shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning)_10%,transparent),0_8px_24px_-16px_oklch(0_0_0/0.25)]",
  destructive:
    "border-[color-mix(in_oklch,var(--destructive)_30%,transparent)] bg-destructive/5",
};

export function Item({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"div"> & {
  variant?: keyof typeof itemVariant;
  size?: "default" | "sm";
}) {
  return (
    <div
      data-slot="item"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/item flex w-full min-w-0 flex-wrap items-center rounded-xl border text-sm transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        size === "default" ? "gap-3 px-3.5 py-3" : "gap-2.5 px-3 py-2",
        itemVariant[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ItemMedia({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(
        "flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none",
        variant === "icon" &&
          "size-7 rounded-lg bg-muted text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export function ItemContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

export function ItemTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "flex min-w-0 items-center gap-2 text-[13.5px] leading-snug font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function ItemDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "text-[12.5px] leading-5 text-muted-foreground [&>a]:underline [&>a]:underline-offset-4",
        className,
      )}
      {...props}
    />
  );
}

export function ItemActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

export function ItemFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className,
      )}
      {...props}
    />
  );
}
