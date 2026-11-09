"use client";

import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { cn } from "@lictory/core/lib/utils";

// Shared shadcn dropdown chrome. Selects, searchable pickers and action menus
// use the same surface and rows while keeping their appropriate ARIA behavior.
const dropdownContentClass =
  "z-50 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-(--shadow-panel)";

const dropdownItemClass =
  "flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

export function DropdownItem({
  asChild = false,
  className,
  ...props
}: ComponentProps<"button"> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      type={asChild ? undefined : "button"}
      data-slot="dropdown-item"
      className={cn(dropdownItemClass, className)}
      {...props}
    />
  );
}

export function DropdownSurface({
  asChild = false,
  className,
  ...props
}: ComponentProps<"div"> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "div";
  return (
    <Component
      data-slot="dropdown-content"
      className={cn(dropdownContentClass, className)}
      {...props}
    />
  );
}
