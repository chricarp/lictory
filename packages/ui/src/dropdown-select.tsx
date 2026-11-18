"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  collectOptions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  textOf,
} from "@lictory/ui/select";

type DropdownSelectProps = Pick<
  ComponentProps<typeof SelectTrigger>,
  | "id"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "aria-invalid"
  | "className"
  | "size"
  | "variant"
> & {
  value?: string | number;
  defaultValue?: string | number;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: ReactNode;
  children: ReactNode;
};

// An empty string is "nothing chosen" to the select. Encode option values so
// domain choices such as “main” and “Not exported” can still use an empty ID.
const encodeValue = (value: string | number) => `value:${value}`;

export function DropdownSelect({
  value,
  defaultValue,
  onValueChange,
  disabled,
  required,
  placeholder,
  children,
  ...triggerProps
}: DropdownSelectProps) {
  const encodeSelection = (selection: string | number | undefined) =>
    selection === undefined
      ? undefined
      : selection === "" && placeholder
        ? ""
        : encodeValue(selection);
  const options = collectOptions(children, (element) => {
    if (element.type !== DropdownSelectOption) return;
    const option = element.props as ComponentProps<typeof DropdownSelectOption>;
    return {
      value: encodeValue(option.value),
      label: option.label ?? textOf(option.children),
      node: option.children,
      disabled: option.disabled,
    };
  });
  return (
    <Select
      value={encodeSelection(value)}
      defaultValue={encodeSelection(defaultValue)}
      onValueChange={(selection) =>
        onValueChange(selection.slice("value:".length))
      }
      options={options}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

export function DropdownSelectOption({
  value,
  ...props
}: Omit<ComponentProps<typeof SelectItem>, "value"> & {
  value: string | number;
}) {
  return <SelectItem value={encodeValue(value)} {...props} />;
}
