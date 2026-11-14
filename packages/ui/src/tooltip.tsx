"use client";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip";
import { popupContainer } from "@lictory/ui/popup";

// Hover/focus hint for a control, given as its child. It names a control
// that has no name of its own and describes one that does.
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive delay={100} container={popupContainer()}>
      <TooltipTrigger
        render={
          isValidElement(children) ? (
            (children as ReactElement<Record<string, unknown>>)
          ) : (
            <span className="inline-flex">{children}</span>
          )
        }
      />
      <TooltipContent
        sideOffset={6}
        collisionPadding={8}
        className="z-50 m-0 rounded-md border bg-popover px-2 py-1 text-xs leading-4 font-medium text-popover-foreground shadow-(--shadow-panel) transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0"
      >
        {label}
      </TooltipContent>
    </TooltipPrimitive>
  );
}
