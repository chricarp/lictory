import { useState, type ReactNode } from "react";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
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
    <RadioGroup<T>
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next);
      }}
      className={cn(
        "grid gap-2",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {options.map((o) => (
        <Radio
          key={o.value}
          value={o.value}
          className="group/choice flex h-auto w-auto cursor-default items-start gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] shadow-(--shadow-border) focus-ring outline-none data-checked:ring-2 data-checked:ring-foreground data-unchecked:not-data-disabled:hover:bg-muted/60 data-disabled:data-unchecked:opacity-60"
        >
          <ChoiceMark />
          <span className="min-w-0">
            <span className="block font-medium">{o.label}</span>
            {o.description && (
              <span className="mt-0.5 block text-xs leading-[18px] text-muted-foreground">
                {o.description}
              </span>
            )}
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}

// The chosen option card says so with a filled radio and a 2px outline in
// the text colour, the same outline as onboarding's choice cards (never a
// grey fill, which reads as disabled). Put it in a `Radio` with the
// `group/choice` and `data-checked:ring-2 data-checked:ring-foreground`
// classes.
export function ChoiceMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-input bg-background group-data-checked/choice:border-primary",
        className,
      )}
    >
      <span className="size-2 rounded-full bg-primary opacity-0 group-data-checked/choice:opacity-100" />
    </span>
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
