import type { ReactNode } from "react";
import { MenuRadioItem as MenuRadioItemPrimitive } from "@ui-sdk/react/menu";
import { cn } from "@lictory/core/lib/utils";
import { dropdownItemClass } from "@lictory/ui/dropdown";
import { MenuItem as MenuItemPrimitive } from "@lictory/ui/menu";
import { Link } from "@lictory/platform/lib/navigation";

// The rows of Spaces' action menus (a page's actions in the tree and in its
// header, the branches of a page): an icon, the action and an optional quiet
// hint, inside the shared Menu.

export {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuSeparator,
  MenuTrigger,
} from "@lictory/ui/menu";

function Row({
  icon,
  hint,
  children,
}: {
  icon: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center text-muted-foreground [&>svg]:size-3.5"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {hint}
        </span>
      )}
    </>
  );
}

export function MenuItem({
  children,
  icon,
  hint,
  onSelect,
  href,
  className,
}: {
  children: ReactNode;
  icon: ReactNode;
  // Quiet text at the end of the row (a count, a shortcut).
  hint?: ReactNode;
  onSelect?: () => void;
  // A link item navigates.
  href?: string;
  className?: string;
}) {
  return (
    <MenuItemPrimitive
      className={className}
      render={href ? <Link href={href} /> : undefined}
      onSelect={onSelect && (() => onSelect())}
    >
      <Row icon={icon} hint={hint}>
        {children}
      </Row>
    </MenuItemPrimitive>
  );
}

// One choice of a MenuRadioGroup; choosing it closes the menu.
export function MenuRadioItem({
  value,
  label,
  children,
  icon,
  hint,
  className,
}: {
  value: string;
  // What typing in the menu matches, when the row holds more than its name.
  label?: string;
  children: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <MenuRadioItemPrimitive
      value={value}
      label={label}
      closeOnSelect
      className={cn(dropdownItemClass, className)}
    >
      <Row icon={icon} hint={hint}>
        {children}
      </Row>
    </MenuRadioItemPrimitive>
  );
}
