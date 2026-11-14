import { forwardRef, type ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Input Group (shadcn/ui, MIT), the frame of Prompt Input: a field with
// addons above (what the message carries) and below (its controls).

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex w-full min-w-0 flex-col rounded-[1.25rem] bg-card shadow-(--shadow-border) transition-shadow duration-200",
        "has-[[data-slot=input-group-control]:focus-visible]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_22%,transparent),0_0_0_4px_color-mix(in_srgb,var(--foreground)_5%,transparent)]",
        "has-[[data-slot=input-group-control]:disabled]:bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupAddon({
  className,
  align = "block-end",
  ...props
}: ComponentProps<"div"> & { align?: "block-start" | "block-end" }) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground",
        align === "block-start"
          ? "order-first px-3 pt-2.5"
          : "order-last px-2.5 pb-2.5",
        className,
      )}
      {...props}
    />
  );
}

export const InputGroupTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea">
>(function InputGroupTextarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="input-group-control"
      className={cn(
        "block max-h-60 min-h-11 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-6 outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed sm:min-h-[52px] touch:text-base",
        className,
      )}
      {...props}
    />
  );
});

export function InputGroupButton({
  className,
  variant = "ghost",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: "ghost" | "primary" | "muted" }) {
  return (
    <button
      type={type}
      data-slot="input-group-button"
      className={cn(
        "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full transition-[background-color,color,transform,opacity] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95 disabled:cursor-not-allowed touch:size-11",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
        variant === "primary" && "bg-foreground text-background",
        variant === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
