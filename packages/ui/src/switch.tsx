"use client";

import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import { cn } from "@lictory/core/lib/utils";
import { lastInFlow } from "@lictory/ui/last-in-flow";

// An on/off setting that applies at once. Name it with `aria-label`, or wrap
// it and its text in a label.
export function Switch({
  className,
  size = "md",
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive>, "className" | "children"> & {
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <SwitchPrimitive
      className={cn(
        "relative m-0 inline-flex shrink-0 cursor-default items-center rounded-full border-0 bg-muted-foreground/25 p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-40",
        size === "md" ? "h-5 w-9" : "h-4 w-7",
        lastInFlow,
        className,
      )}
      {...props}
    >
      <SwitchThumb
        className={cn(
          "inline-block translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
          size === "md"
            ? "size-4 data-checked:translate-x-4.5"
            : "size-3 data-checked:translate-x-3.5",
        )}
      />
    </SwitchPrimitive>
  );
}
