"use client";

import type { ComponentProps, MouseEvent, ReactNode, Ref } from "react";
import {
  Button as ButtonPrimitive,
  type ButtonActionDetails,
} from "@ui-sdk/react/button";

import { cn } from "@lictory/core/lib/utils";

type Primitive = ComponentProps<typeof ButtonPrimitive>;

type ButtonProps = Omit<
  ComponentProps<"button">,
  "onClick" | "ref" | "children" | "className"
> &
  Pick<
    Primitive,
    "focusableWhenDisabled" | "pendingAnnouncement" | "render"
  > & {
    ref?: Ref<HTMLButtonElement> | ((node: HTMLElement | null) => void);
    // Returning a promise keeps the button busy until it settles.
    onClick?: (
      event: MouseEvent<HTMLButtonElement>,
      details: ButtonActionDetails,
    ) => unknown;
    children?: ReactNode;
    className?: string;
    variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
    size?: "sm" | "md" | "lg" | "icon";
  };

type Look = Pick<ButtonProps, "variant" | "size">;

// The button's look, for a ui-sdk part that is a button of its own.
export const buttonClass = ({ variant = "primary", size = "md" }: Look = {}) =>
  cn(
    // Pills: the shape of every action, from the sidebar to the website.
    "inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 rounded-full border-0 font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 not-data-disabled:active:scale-[0.96] data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-progress",
    size === "sm" && "h-7 px-3 text-xs",
    size === "md" && "h-8 px-3.5 text-[13px]",
    size === "lg" && "h-10 px-5 text-sm",
    size === "icon" && "size-7 p-0 text-xs",
    variant === "primary" &&
      "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-(--primary-hover)",
    variant === "secondary" &&
      "bg-card text-foreground shadow-(--shadow-border) hover:bg-muted hover:shadow-(--shadow-border-hover)",
    variant === "outline" &&
      "border bg-transparent text-foreground hover:bg-muted",
    variant === "danger" &&
      "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    variant === "ghost" &&
      "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  );

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-variant={variant}
      data-size={size}
      className={cn(buttonClass({ variant, size }), className)}
      {...(props as Primitive)}
    />
  );
}
