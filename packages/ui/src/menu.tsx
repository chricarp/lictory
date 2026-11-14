"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  Menu as MenuPrimitive,
  MenuCheckboxItem as MenuCheckboxItemPrimitive,
  MenuContent as MenuContentPrimitive,
  MenuGroup,
  MenuGroupLabel,
  MenuItem as MenuItemPrimitive,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem as MenuRadioItemPrimitive,
  MenuSeparator as MenuSeparatorPrimitive,
  MenuTrigger as MenuTriggerPrimitive,
} from "@ui-sdk/react/menu";
import { Check } from "lucide-react";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import { ownName } from "@lictory/ui/named";
import { popupContainer } from "@lictory/ui/popup";
import { cn } from "@lictory/core/lib/utils";

type Styled<Props> = Omit<Props, "className"> & { className?: string };

// A menu of actions opened from a button: arrow keys move between items,
// typing finds one, and choosing an item closes the menu.
export function Menu(props: ComponentProps<typeof MenuPrimitive>) {
  return <MenuPrimitive container={popupContainer()} {...props} />;
}

// The button that opens the menu. Pass your own button as `render`.
export function MenuTrigger({
  render,
  ...props
}: Omit<ComponentProps<typeof MenuTriggerPrimitive>, "render"> & {
  render?: ReactElement<Record<string, unknown>>;
}) {
  return <MenuTriggerPrimitive render={render} {...props} />;
}

export function MenuContent({
  className,
  align = "start",
  width,
  style,
  render,
  ...props
}: Styled<ComponentProps<typeof MenuContentPrimitive>> & {
  width?: number | "trigger";
}) {
  const label = props["aria-label"];
  return (
    <MenuContentPrimitive
      // A menu is named by its trigger unless it is given a name of its own.
      render={render ?? (label ? ownName : undefined)}
      data-popover
      align={align}
      sideOffset={4}
      collisionPadding={8}
      style={{
        width: width === "trigger" ? "var(--anchor-width)" : width,
        maxHeight: "var(--available-height)",
        ...(typeof style === "object" ? style : undefined),
      }}
      className={cn(
        dropdownContentClass,
        "min-w-40 overflow-y-auto p-1",
        className,
      )}
      {...props}
    />
  );
}

const itemClass = cn(
  dropdownItemClass,
  "data-destructive:text-destructive data-destructive:[&_svg]:text-destructive",
);

export function MenuItem({
  className,
  ...props
}: Styled<ComponentProps<typeof MenuItemPrimitive>>) {
  return <MenuItemPrimitive className={cn(itemClass, className)} {...props} />;
}

function Checked() {
  return (
    <MenuItemIndicator className="ml-auto flex size-3.5 items-center justify-center">
      <Check className="size-3.5 text-primary" aria-hidden />
    </MenuItemIndicator>
  );
}

export function MenuCheckboxItem({
  className,
  children,
  ...props
}: Styled<ComponentProps<typeof MenuCheckboxItemPrimitive>> & {
  children?: ReactNode;
}) {
  return (
    <MenuCheckboxItemPrimitive className={cn(itemClass, className)} {...props}>
      {children}
      <Checked />
    </MenuCheckboxItemPrimitive>
  );
}

// Choosing one closes the menu, as picking any other row does.
export function MenuRadioItem({
  className,
  children,
  closeOnSelect = true,
  ...props
}: Styled<ComponentProps<typeof MenuRadioItemPrimitive>> & {
  children?: ReactNode;
}) {
  return (
    <MenuRadioItemPrimitive
      className={cn(itemClass, className)}
      closeOnSelect={closeOnSelect}
      {...props}
    >
      {children}
      <Checked />
    </MenuRadioItemPrimitive>
  );
}

export function MenuLabel({
  className,
  ...props
}: Styled<ComponentProps<typeof MenuGroupLabel>>) {
  return (
    <MenuGroupLabel
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: Styled<ComponentProps<typeof MenuSeparatorPrimitive>>) {
  return (
    <MenuSeparatorPrimitive
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export { MenuGroup, MenuRadioGroup };
