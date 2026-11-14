"use client";

import type { ComponentProps } from "react";
import {
  Checkbox as CheckboxPrimitive,
  CheckboxIndicator,
} from "@ui-sdk/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";

// One independent choice. Wrap it and its text in a label, or name it with
// `aria-label`.
export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<typeof CheckboxPrimitive>, "className" | "children"> & {
  className?: string;
}) {
  return (
    <CheckboxPrimitive
      className={cn(
        "m-0 inline-grid size-4 shrink-0 cursor-default place-items-center rounded border border-input bg-card p-0 text-primary-foreground transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 data-indeterminate:border-primary data-indeterminate:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxIndicator className="grid place-items-center">
        <Check
          className="size-3 in-data-indeterminate:hidden"
          strokeWidth={3}
          aria-hidden
        />
        <Minus
          className="hidden size-3 in-data-indeterminate:block"
          strokeWidth={3}
          aria-hidden
        />
      </CheckboxIndicator>
    </CheckboxPrimitive>
  );
}
