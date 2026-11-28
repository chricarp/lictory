import { Textarea } from "@ui-sdk/react/textarea";
import { Toggle } from "@ui-sdk/react/toggle";
import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Input Group (shadcn/ui, MIT), the frame of Prompt Input: a field with
// addons above (what the message carries) and below (its controls).

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex w-full min-w-0 flex-col rounded-[1.25rem] bg-card inset-ring inset-ring-input transition-shadow duration-200",
        "has-[[data-slot=textarea]:focus-visible]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_22%,transparent),0_0_0_4px_color-mix(in_srgb,var(--foreground)_5%,transparent)]",
        "has-[[data-slot=textarea]:disabled]:bg-muted/40",
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

// Grows with its text up to its maximum height, then scrolls.
export function InputGroupTextarea({
  className,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "className" | "autoResize"> & {
  className?: string;
}) {
  return (
    <Textarea
      autoResize
      className={cn(
        "block max-h-60 min-h-11 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-6 outline-none placeholder:text-placeholder disabled:cursor-not-allowed sm:min-h-[52px] touch:text-base",
        className,
      )}
      {...props}
    />
  );
}

const buttonClass =
  "relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full transition-[background-color,color,transform,opacity] duration-150 ease-out outline-none focus-ring active:scale-95 disabled:cursor-not-allowed touch:size-11";
const ghostClass =
  "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";

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
        buttonClass,
        variant === "ghost" && ghostClass,
        variant === "primary" && "bg-foreground text-background",
        variant === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

// A ghost button that stays on while its mode is active, such as dictation.
export function InputGroupToggle({
  className,
  ...props
}: Omit<ComponentProps<typeof Toggle>, "className"> & { className?: string }) {
  return (
    <Toggle
      className={cn(
        buttonClass,
        ghostClass,
        "data-pressed:bg-muted data-pressed:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
