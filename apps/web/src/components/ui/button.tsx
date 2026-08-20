"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader } from "@/components/ui/icons";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium tracking-tight transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border border-ember bg-ember text-white shadow-[0_8px_24px_rgb(var(--ember)/0.18)] hover:border-ember-bright hover:bg-ember-bright",
        secondary:
          "border border-hairline-strong bg-surface text-foreground hover:bg-surface-strong",
        ghost: "text-muted hover:bg-surface-strong hover:text-foreground",
        outline:
          "border border-hairline-strong text-foreground hover:border-[rgb(var(--ember)/0.65)] hover:text-ember-bright",
        danger:
          "border border-danger bg-danger text-white hover:bg-[rgb(var(--danger)/0.88)]",
        link: "text-ember-bright underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[0.8125rem] [&_svg]:size-3.5",
        md: "h-10 px-4 [&_svg]:size-4",
        lg: "h-12 px-6 text-base [&_svg]:size-[1.125rem]",
        icon: "size-10 [&_svg]:size-4",
        "icon-sm": "size-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  // `Slot` requires exactly one child, so the spinner is only ever composed in
  // for real `<button>` elements.
  const content = asChild ? (
    children
  ) : (
    <>
      {loading ? (
        <>
          <Loader className="animate-spin" aria-hidden />
          <span className="sr-only">Loading</span>
        </>
      ) : null}
      {children}
    </>
  );

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {content}
    </Comp>
  );
}

export { buttonVariants };
