import { useId, type ReactNode } from "react";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { RadioDot, radioClass } from "@lictory/ui/radio";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { cn } from "@lictory/core/lib/utils";

export { Dialog } from "@lictory/ui/dialog";

// A labelled field with an optional hint, used across Spaces forms.
export function Field({
  label,
  hint,
  htmlFor,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> (optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// The round mark of a radio, for radios drawn inside a row or card of their
// own.
export { RadioDot, radioClass };

// The card around a radio or checkbox and its text: tinted while checked.
// The checked outline steps aside for the focus ring, so the two never
// compete for the same ring.
// Selected: a 2px outline in the text colour with the filled radio, as in
// onboarding and settings (never a grey fill, which reads as disabled).
export const choiceCardClass =
  "flex cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-[13px] shadow-(--shadow-border) not-has-[[data-checked]]:hover:bg-muted/60 has-focus-visible:ring-2 has-focus-visible:ring-ring/60 has-[button[data-checked]:not(:focus-visible)]:ring-2 has-[button[data-checked]:not(:focus-visible)]:ring-foreground has-[[data-disabled]]:cursor-default";

// Radios drawn as cards: arrow keys move between them and the group is
// named by its legend.
export function RadioCards<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  columns = 2,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; description?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  const legendId = useId();
  return (
    <div className="space-y-1.5">
      <div id={legendId} className="text-xs font-medium">
        {legend}
      </div>
      <RadioGroup<T>
        name={name}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        disabled={disabled}
        aria-labelledby={legendId}
        className={cn(
          "grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
        )}
      >
        {options.map((option) => (
          <label key={option.value} className={choiceCardClass}>
            <Radio value={option.value} className={cn(radioClass, "mt-0.5")}>
              <RadioDot />
            </Radio>
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

// A short choice between two or three named options, drawn as a segmented
// control (arrow keys move, the group is named by its label), with the
// chosen option explained underneath.
export function SegmentedChoice<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled,
  status,
}: {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string; description?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  // A settings row's save state, beside the label.
  status?: ReactNode;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const chosen = options.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-2">
          <span id={labelId} className="text-xs font-medium">
            {label}
          </span>
          {status}
        </span>
        <SegmentedControl<T>
          name={name}
          value={value}
          onValueChange={(next) => {
            if (next !== null) onChange(next);
          }}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={chosen?.description ? descriptionId : undefined}
          className="inline-flex gap-0 rounded-full bg-muted p-0.5"
        >
          {options.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              className="inline-flex h-7 flex-none cursor-pointer items-center rounded-full border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-checked:bg-card data-checked:text-foreground data-checked:shadow-(--shadow-border) data-disabled:cursor-default"
            >
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </div>
      {chosen?.description && (
        <p
          id={descriptionId}
          className="text-xs leading-5 text-muted-foreground"
        >
          {chosen.description}
        </p>
      )}
    </div>
  );
}
