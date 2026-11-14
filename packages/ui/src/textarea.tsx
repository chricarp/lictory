"use client";

import type { ComponentProps } from "react";
import { Textarea as TextareaPrimitive } from "@ui-sdk/react/textarea";

import { cn } from "@lictory/core/lib/utils";

export function Textarea({
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "onSubmit" | "value" | "defaultValue"> &
  Pick<
    ComponentProps<typeof TextareaPrimitive>,
    | "value"
    | "defaultValue"
    | "onValueChange"
    | "controller"
    | "autoResize"
    | "onSubmit"
    | "submitShortcut"
  >) {
  return (
    <TextareaPrimitive
      className={cn(
        "min-h-20 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-[15px] text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-3 focus:ring-primary/10 data-disabled:cursor-not-allowed data-disabled:opacity-60 touch:text-base",
        className,
      )}
      {...(props as ComponentProps<typeof TextareaPrimitive>)}
    />
  );
}
