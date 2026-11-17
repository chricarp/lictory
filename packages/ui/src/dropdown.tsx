"use client";

import type { ReactElement } from "react";
import { renderElement, type PartProps } from "@ui-sdk/react/primitive";
import { cn } from "@lictory/core/lib/utils";

// Shared dropdown chrome. Selects, searchable pickers and action menus use
// the same surface and rows while keeping their appropriate ARIA behavior.
export const dropdownContentClass =
  "z-50 m-0 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover p-0 text-popover-foreground shadow-(--shadow-panel) outline-none";

export const dropdownItemClass =
  "flex min-h-8 w-full cursor-default items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left text-[13px] font-normal text-popover-foreground outline-none select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

type Styled<Tag extends "button" | "div"> = Omit<
  PartProps<Tag>,
  "className" | "render"
> & {
  className?: string;
  // Renders this element with the row's or surface's chrome instead.
  render?: ReactElement<Record<string, unknown>>;
};

export function DropdownItem({
  className,
  render,
  ...props
}: Styled<"button">) {
  return renderElement(
    "button",
    {
      type: render ? undefined : "button",
      "data-dropdown-item": "",
      ...props,
      className: cn(dropdownItemClass, className),
    },
    render,
  );
}

export function DropdownSurface({
  className,
  render,
  ...props
}: Styled<"div">) {
  return renderElement(
    "div",
    {
      "data-dropdown-content": "",
      ...props,
      className: cn(dropdownContentClass, className),
    },
    render,
  );
}
