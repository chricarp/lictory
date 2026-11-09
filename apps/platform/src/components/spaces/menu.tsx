import { DropdownItem } from "@lictory/ui/dropdown";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "@lictory/platform/lib/navigation";

// Action menus of Spaces (a page's actions in the tree and in its header),
// drawn inside a Popover: the first item takes focus once the popover is
// placed (it starts hidden while it measures itself), the arrow keys move
// between items (the menu pattern), Tab and Escape leave.

export function Menu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      (
        ref.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        ref.current?.querySelector<HTMLElement>(ITEMS)
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={ref}
      className="max-h-[inherit] overflow-y-auto overscroll-contain p-1"
      role="menu"
      aria-label={label}
    >
      {children}
    </div>
  );
}

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const menu = event.currentTarget.closest('[role="menu"]');
  const items = [...(menu?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
  const index = items.indexOf(event.currentTarget);
  const next =
    event.key === "ArrowDown"
      ? items[(index + 1) % items.length]
      : event.key === "ArrowUp"
        ? items[(index - 1 + items.length) % items.length]
        : event.key === "Home"
          ? items[0]
          : event.key === "End"
            ? items.at(-1)
            : undefined;
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

export function MenuItem({
  children,
  icon,
  hint,
  onSelect,
  href,
  checked,
  className,
}: {
  children: ReactNode;
  icon: ReactNode;
  // A choice among several (a radio item); the chosen one shows a check.
  checked?: boolean;
  // Quiet text at the end of the row (a count, a shortcut).
  hint?: ReactNode;
  onSelect?: () => void;
  // A link item navigates; `onSelect` still runs (to close the menu).
  href?: string;
  className?: string;
}) {
  const content = (
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
  if (href)
    return (
      <DropdownItem asChild>
        <Link
          href={href}
          role="menuitem"
          className={className}
          onClick={onSelect}
          onKeyDown={moveFocus}
        >
          {content}
        </Link>
      </DropdownItem>
    );
  return (
    <DropdownItem
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={className}
      onClick={onSelect}
      onKeyDown={moveFocus}
    >
      {content}
    </DropdownItem>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}
