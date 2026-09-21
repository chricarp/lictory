import type { InputHTMLAttributes } from "react";

import { Input } from "~/components/ui/input";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function FormField({ label, hint, id, ...props }: FormFieldProps) {
  return (
    <label htmlFor={id} className="grid gap-2 text-sm font-medium">
      <span className="flex items-center justify-between">
        {label}
        {hint ? (
          <span className="text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      <Input id={id} {...props} />
    </label>
  );
}

export function FormMessage({
  children,
  tone = "error",
}: {
  children?: string | null;
  tone?: "error" | "success" | "info";
}) {
  if (!children) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-xl bg-destructive/8 px-3.5 py-3 text-sm leading-5 text-destructive"
          : tone === "success"
            ? "rounded-xl bg-emerald-500/10 px-3.5 py-3 text-sm leading-5 text-emerald-700 dark:text-emerald-300"
            : "rounded-xl bg-primary/8 px-3.5 py-3 text-sm leading-5 text-primary"
      }
    >
      {children}
    </div>
  );
}
