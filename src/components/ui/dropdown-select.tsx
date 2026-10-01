"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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

// Radix reserves an empty string for placeholders. Encode option values so
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
  return (
    <Select
      value={encodeSelection(value)}
      defaultValue={encodeSelection(defaultValue)}
      onValueChange={(selection) =>
        onValueChange(selection.slice("value:".length))
      }
      disabled={disabled}
      required={required}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>{children}</SelectGroup>
      </SelectContent>
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
