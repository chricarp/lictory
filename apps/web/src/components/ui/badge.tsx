import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium tracking-tight transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-hairline-strong bg-surface-strong text-muted",
        ember:
          "border-[rgb(var(--ember)/0.35)] bg-[rgb(var(--ember)/0.14)] text-ember-bright",
        iris: "border-[rgb(var(--iris)/0.35)] bg-[rgb(var(--iris)/0.14)] text-[rgb(var(--iris))]",
        success:
          "border-[rgb(var(--success)/0.35)] bg-[rgb(var(--success)/0.12)] text-success",
        warning:
          "border-[rgb(var(--warning)/0.35)] bg-[rgb(var(--warning)/0.12)] text-warning",
        danger:
          "border-[rgb(var(--danger)/0.35)] bg-[rgb(var(--danger)/0.12)] text-danger",
        outline: "border-hairline-strong text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
