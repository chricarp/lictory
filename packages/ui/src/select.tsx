"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectGroupLabel,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
} from "@ui-sdk/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import { popupContainer } from "@lictory/ui/popup";
import { cn } from "@lictory/core/lib/utils";
import { lastInFlow } from "@lictory/ui/last-in-flow";

export type SelectOption = {
  value: string;
  label: string;
  node: ReactNode;
  disabled?: boolean;
};

// The text of what an option shows, however it is wrapped.
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

// The options written as children, read before the list ever opens so the
// trigger can show the chosen one. `read` recognizes an option element.
export function collectOptions(
  children: ReactNode,
  read: (element: ReactElement) => SelectOption | undefined,
  found: SelectOption[] = [],
) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    const option = read(child);
    if (option) found.push(option);
    else collectOptions(child.props.children, read, found);
  });
  return found;
}

const Options = createContext<ReadonlyMap<string, ReactNode>>(new Map());

type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  // Options the children do not spell out as `SelectItem` elements.
  options?: SelectOption[];
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  form?: string;
};

function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  children,
  onOpenChange,
  ...props
}: SelectProps) {
  const found =
    options ??
    collectOptions(children, (element) => {
      if (element.type !== SelectItem) return;
      const item = element.props as ComponentProps<typeof SelectItem>;
      return {
        value: item.value,
        label: item.label ?? textOf(item.children),
        node: item.children,
        disabled: item.disabled,
      };
    });
  const key = found
    .map((o) => `${o.value}\u0000${o.label}\u0000${o.disabled ? 1 : 0}`)
    .join("\u0001");
  // The select finds options by typing from this data, not from what is
  // rendered, so a disabled option has to be marked here too.
  const items = useMemo(
    () =>
      found.map(({ value, label, disabled }) => ({ value, label, disabled })),
    // The labels, not the array's identity, decide what the trigger shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const nodes = new Map(found.map((o) => [o.value, o.node]));
  return (
    <SelectPrimitive<string>
      // An empty string means nothing is chosen yet, as in a native select.
      value={value === undefined ? undefined : value === "" ? null : value}
      defaultValue={defaultValue === "" ? null : defaultValue}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next);
      }}
      onOpenChange={onOpenChange && ((next) => onOpenChange(next))}
      items={items}
      container={popupContainer()}
      {...props}
    >
      <Options value={nodes}>{children}</Options>
    </SelectPrimitive>
  );
}

function SelectGroup({
  className,
  ...props
}: ComponentProps<typeof SelectGroupPrimitive>) {
  return <SelectGroupPrimitive className={className} {...props} />;
}

function SelectValue({
  placeholder,
  ...props
}: Omit<ComponentProps<typeof SelectValuePrimitive>, "placeholder"> & {
  placeholder?: ReactNode;
}) {
  const nodes = useContext(Options);
  return (
    <SelectValuePrimitive
      placeholder={typeof placeholder === "string" ? placeholder : undefined}
      {...props}
    >
      {(state) =>
        state.placeholder
          ? placeholder
          : (nodes.get(String(state.value)) ?? state.labels.join(", "))
      }
    </SelectValuePrimitive>
  );
}

function SelectTrigger({
  className,
  size = "default",
  variant = "field",
  children,
  ...props
}: Omit<
  ComponentProps<typeof SelectTriggerPrimitive>,
  "className" | "children"
> & {
  className?: string;
  children?: ReactNode;
  size?: "sm" | "default" | "lg";
  variant?: "field" | "secondary";
}) {
  return (
    <SelectTriggerPrimitive
      data-size={size}
      className={cn(
        "inline-flex w-fit min-w-0 cursor-default items-center justify-between gap-2 text-foreground focus-ring transition-[background-color,color,box-shadow] duration-100 ease-out outline-none select-none aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[placeholder]:text-muted-foreground/70 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        variant === "field" &&
          "border border-input bg-card font-normal shadow-[0_1px_2px_oklch(0_0_0/0.03)] hover:bg-muted/50 aria-invalid:border-destructive",
        variant === "secondary" &&
          "bg-card font-medium shadow-(--shadow-border) hover:bg-muted",
        // Form fields share the input's shape; every other trigger is a pill
        // like the buttons beside it.
        variant === "field" ? "rounded-lg" : "rounded-full",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "default" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-3.5 text-[13px]",
        lastInFlow,
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon strokeWidth={1.5} aria-hidden />
    </SelectTriggerPrimitive>
  );
}

function SelectContent({
  className,
  align = "start",
  ...props
}: Omit<ComponentProps<typeof SelectContentPrimitive>, "className"> & {
  className?: string;
}) {
  return (
    <SelectContentPrimitive
      data-popover
      align={align}
      sideOffset={4}
      collisionPadding={8}
      className={cn(
        dropdownContentClass,
        "max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] scroll-my-1 overflow-y-auto p-1",
        className,
      )}
      {...props}
    />
  );
}

function SelectLabel({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectGroupLabel>, "className"> & {
  className?: string;
}) {
  return (
    <SelectGroupLabel
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: {
  value: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <SelectItemPrimitive<string>
      className={cn(dropdownItemClass, "relative pr-8", className)}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        {typeof children === "number" ? String(children) : children}
      </span>
      <SelectItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
        <CheckIcon aria-hidden />
      </SelectItemIndicator>
    </SelectItemPrimitive>
  );
}

function SelectSeparator({
  className,
  ...props
}: Omit<ComponentProps<typeof SelectSeparatorPrimitive>, "className"> & {
  className?: string;
}) {
  return (
    <SelectSeparatorPrimitive
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
