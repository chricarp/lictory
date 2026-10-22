"use client";
import { useState, type ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";
import type { Command } from "@lictory/core/contracts/protocol";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { InlineError } from "@lictory/platform/components/workspace/settings-section";

// Commands fail with an actionable server message; show it where it happened.
export function useCommand() {
  const { mutate } = useWorkspace();
  const [error, setError] = useState<string>();
  const run = async (command: Command) => {
    setError(undefined);
    try {
      await mutate(command);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
      return false;
    }
  };
  return { run, error };
}

export type UpdateProject = Omit<
  Extract<Command, { type: "updateProject" }>,
  "type" | "projectId"
>;

export function SectionError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="border-t px-5 py-3">
      <InlineError>{error}</InlineError>
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  disabled,
  columns = 3,
  label,
}: {
  value: T;
  options: { value: T; label: string; description?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  columns?: 2 | 3;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "grid gap-2",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-2 text-left text-[13px] shadow-(--shadow-border) disabled:cursor-default",
            value === o.value
              ? "bg-primary/6 ring-1 ring-primary/40"
              : "enabled:hover:bg-muted/60",
            disabled && value !== o.value && "opacity-60",
          )}
        >
          <span className="font-medium">{o.label}</span>
          {o.description && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {o.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
