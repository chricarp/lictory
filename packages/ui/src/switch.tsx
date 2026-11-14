"use client";

import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import { cn } from "@lictory/core/lib/utils";

// An on/off setting that applies at once. Name it with `aria-label`, or wrap
// it and its text in a label.
export function Switch({
  className,
  ...props
}: Omit<ComponentProps<typeof SwitchPrimitive>, "className" | "children"> & {
  className?: string;
}) {
  return (
    <SwitchPrimitive
      className={cn(
        "relative m-0 inline-flex h-5 w-9 shrink-0 cursor-default items-center rounded-full border-0 bg-muted-foreground/25 p-0 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <SwitchThumb className="inline-block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out data-checked:translate-x-4.5" />
    </SwitchPrimitive>
  );
}
