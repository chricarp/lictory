"use client";

import type { ComponentProps } from "react";
import { Input as InputPrimitive } from "@ui-sdk/react/input";

import { cn } from "@lictory/core/lib/utils";

export const inputClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3.5 text-[15px] text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-placeholder focus:border-primary/60 focus:ring-3 focus:ring-primary/10 aria-invalid:border-destructive/70 aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive/15 data-disabled:cursor-not-allowed data-disabled:opacity-60 touch:text-base";

type Primitive = ComponentProps<typeof InputPrimitive>;

type InputProps = ComponentProps<"input"> &
  Pick<Primitive, "onValueChange" | "controller">;

const text = (value: InputProps["value"]) =>
  value === undefined ? undefined : String(value);

export function Input({
  className,
  value,
  defaultValue,
  ...props
}: InputProps) {
  return (
    <InputPrimitive
      className={cn(inputClass, className)}
      value={text(value)}
      defaultValue={text(defaultValue)}
      {...props}
    />
  );
}
