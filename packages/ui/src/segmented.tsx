"use client";

import type { ReactNode } from "react";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { cn } from "@lictory/core/lib/utils";

// One of a few views or filters, all visible in a compact row. Arrow keys
// move the choice; name the control with `aria-label`.
export function Segmented<T extends string>({
  value,
  onValueChange,
  disabled,
  className,
  children,
  ...props
}: {
  value: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <SegmentedControl<string>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as T);
      }}
      disabled={disabled}
      className={cn(
        "inline-flex items-center rounded-md bg-muted p-0.5",
        className,
      )}
      {...props}
    >
      {children}
    </SegmentedControl>
  );
}

export function SegmentedItem({
  value,
  disabled,
  className,
  children,
  ...props
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <SegmentedControlItem
      value={value}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 cursor-default items-center justify-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground focus-ring outline-none select-none hover:text-foreground data-checked:bg-card data-checked:text-foreground data-checked:shadow-(--shadow-border) data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </SegmentedControlItem>
  );
}
