"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

export function Switch({
  className,
  checked: controlledChecked,
  defaultChecked,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const [uncontrolledChecked, setUncontrolledChecked] = React.useState(
    defaultChecked ?? false,
  );
  const [initialized, setInitialized] = React.useState(false);
  const checked = controlledChecked ?? uncontrolledChecked;

  return (
    <SwitchPrimitive.Root
      checked={checked}
      data-on={checked}
      onCheckedChange={(nextChecked) => {
        setInitialized(true);
        if (controlledChecked === undefined)
          setUncontrolledChecked(nextChecked);
        onCheckedChange?.(nextChecked);
      }}
      className={cn(
        "t-toggle peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-hairline-strong",
        initialized && "is-init",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-ember data-[state=unchecked]:bg-surface-strong",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "t-toggle-thumb pointer-events-none ml-0.5 block size-4 rounded-full bg-white shadow",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
