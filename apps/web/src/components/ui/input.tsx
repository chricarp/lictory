import * as React from "react";

import { cn } from "@/lib/utils";

const fieldStyles =
  "w-full rounded-md border border-hairline-strong bg-canvas-raised px-3.5 text-sm text-foreground placeholder:text-subtle transition-colors outline-none focus:border-[rgb(var(--ember)/0.65)] disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(fieldStyles, "h-10", className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldStyles,
        "min-h-24 resize-y py-2.5 leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "text-xs font-medium uppercase tracking-[0.08em] text-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.isValidElement<{ id?: string }>(children)
        ? React.cloneElement(children, { id })
        : children}
      {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

export { fieldStyles };
