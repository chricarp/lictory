import type { InputHTMLAttributes, ReactNode } from "react";

import { Input } from "~/components/ui/input";

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
};

export function FormField({ label, hint, id, ...props }: FormFieldProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <Input id={id} {...props} />
    </div>
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
          ? "rounded-lg bg-destructive/8 px-3 py-2.5 text-[13px] leading-5 text-destructive"
          : tone === "success"
            ? "rounded-lg bg-emerald-500/10 px-3 py-2.5 text-[13px] leading-5 text-emerald-700 dark:text-emerald-300"
            : "rounded-lg bg-primary/8 px-3 py-2.5 text-[13px] leading-5 text-primary"
      }
    >
      {children}
    </div>
  );
}
