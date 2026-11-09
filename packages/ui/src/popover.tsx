"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { DropdownSurface, DropdownItem } from "@lictory/ui/dropdown";
import { Check, Loader2, Search } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";

// Shared shadcn/Radix surface for searchable dropdowns and contextual panels.
type PopoverContextValue = { close: () => void; labelId: string };
const PopoverContext = createContext<PopoverContextValue | null>(null);
export const usePopover = () => useContext(PopoverContext);

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width = 240,
  open: controlled,
  onOpenChange,
  disabled,
  className,
}: {
  trigger: (props: {
    "data-state": "open" | "closed";
    onClick: () => void;
    ref: (node: HTMLElement | null) => void;
    "aria-expanded": boolean;
    "aria-haspopup": "dialog";
    disabled?: boolean;
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  side?: "bottom" | "top" | "right";
  width?: number | "trigger";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [internal, setInternal] = useState(false);
  const open = controlled ?? internal;
  const setOpen = useCallback(
    (value: boolean) => {
      setInternal(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const setTriggerNode = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);
  const labelId = useId();
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* Editable pickers anchor to an input container, rather than a button.
          Keep their semantics and let Radix position and dismiss the panel. */}
      <PopoverPrimitive.Anchor asChild>
        {/* The render prop receives a callback ref; it never reads current. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {trigger({
          "data-state": open ? "open" : "closed",
          onClick: () => {
            if (!disabled) setOpen(!open);
          },
          ref: setTriggerNode,
          "aria-expanded": open,
          "aria-haspopup": "dialog",
          disabled,
        })}
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <DropdownSurface asChild>
          <PopoverPrimitive.Content
            ref={panelRef}
            data-popover
            aria-labelledby={labelId}
            align={align}
            side={side}
            sideOffset={4}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // An editor action may deliberately focus its document before
              // closing the menu. Restore only focus left in the panel.
              const active = document.activeElement;
              if (
                !active ||
                active === document.body ||
                panelRef.current?.contains(active)
              )
                triggerRef.current?.focus({ preventScroll: true });
            }}
            onInteractOutside={(event) => {
              if (triggerRef.current?.contains(event.target as Node))
                event.preventDefault();
            }}
            style={{
              width:
                width === "trigger"
                  ? "var(--radix-popover-trigger-width)"
                  : width,
              maxHeight: "var(--radix-popover-content-available-height)",
            }}
            className={cn("flex flex-col", className)}
          >
            <PopoverContext.Provider value={{ close, labelId }}>
              {typeof children === "function" ? children(close) : children}
            </PopoverContext.Provider>
          </PopoverPrimitive.Content>
        </DropdownSurface>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export type PickerOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
};

// Searchable list with roving keyboard focus. Selecting an option closes the
// popover unless `multiple` is set.
export function Picker<T extends string>({
  options,
  value,
  onSelect,
  placeholder = "Filter…",
  emptyText = "No matches.",
  multiple = false,
  title,
  footer,
  searchable,
  hideSearch = false,
  loading = false,
  hasMore = false,
  onQueryChange,
  onEndReached,
  activeIndex,
  onActiveIndexChange,
  listboxId,
}: {
  options: PickerOption<T>[];
  value?: T | T[] | null;
  onSelect: (value: T) => void;
  placeholder?: string;
  emptyText?: string;
  multiple?: boolean;
  title?: string;
  footer?: ReactNode;
  searchable?: boolean;
  hideSearch?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  onQueryChange?: (query: string) => void;
  onEndReached?: () => void;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  listboxId?: string;
}) {
  const popover = usePopover();
  const [query, setQuery] = useState("");
  const [uncontrolledActive, setUncontrolledActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const showSearch =
    !hideSearch &&
    (searchable ?? (options.length > 6 || Boolean(onQueryChange)));
  const active = activeIndex ?? uncontrolledActive;
  const setActive = (index: number | ((current: number) => number)) => {
    const next = typeof index === "function" ? index(active) : index;
    if (onActiveIndexChange) onActiveIndexChange(next);
    else setUncontrolledActive(next);
  };
  useEffect(() => {
    if (showSearch) inputRef.current?.focus();
    else listRef.current?.focus();
  }, [showSearch]);
  const q = query.trim().toLowerCase();
  const [lastQuery, setLastQuery] = useState(q);
  if (activeIndex === undefined && lastQuery !== q) {
    setLastQuery(q);
    setUncontrolledActive(0);
  } else if (lastQuery !== q) {
    setLastQuery(q);
  }
  const optionId = listboxId ?? (title ? undefined : popover?.labelId);
  const filtered = onQueryChange
    ? options
    : options.filter(
        (o) =>
          !q ||
          o.label.toLowerCase().includes(q) ||
          (o.keywords?.toLowerCase().includes(q) ?? false) ||
          (o.hint?.toLowerCase().includes(q) ?? false),
      );
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-active]")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (!onEndReached || !hasMore || loading) return;
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReached();
      },
      { root, rootMargin: "64px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onEndReached, hasMore, filtered.length, loading]);
  const selected = new Set(
    Array.isArray(value)
      ? value
      : value !== undefined && value !== null
        ? [value]
        : [],
  );
  const choose = (option: PickerOption<T>) => {
    onSelect(option.value);
    if (!multiple) popover?.close();
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys and Enter bubble from the search field (combobox pattern); the list wrapper is not a control.
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((a) => Math.min(filtered.length - 1, a + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          const option = filtered[active];
          if (option) choose(option);
        }
      }}
    >
      {title && (
        <div
          id={hideSearch ? undefined : popover?.labelId}
          className="px-3 pt-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
        >
          {title}
        </div>
      )}
      {showSearch ? (
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onQueryChange?.(e.target.value);
            }}
            placeholder={placeholder}
            autoFocus
            aria-label={title ?? placeholder}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 touch:text-base"
          />
        </div>
      ) : (
        <input
          ref={inputRef}
          aria-hidden
          tabIndex={-1}
          className="sr-only"
          readOnly
        />
      )}
      <div
        ref={listRef}
        id={optionId}
        role="listbox"
        tabIndex={showSearch ? -1 : 0}
        aria-label={title ?? placeholder}
        aria-multiselectable={multiple || undefined}
        className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1"
      >
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {loading ? "Searching…" : emptyText}
          </p>
        )}
        {filtered.map((option, index) => (
          <DropdownItem
            id={optionId ? `${optionId}-option-${option.value}` : undefined}
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected.has(option.value)}
            data-active={index === active || undefined}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(option)}
            className={cn(
              index === active && "bg-accent text-accent-foreground",
            )}
          >
            {option.icon && (
              <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                {option.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.hint && (
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                {option.hint}
              </span>
            )}
            {selected.has(option.value) && (
              <Check className="size-3.5 shrink-0 text-primary" />
            )}
          </DropdownItem>
        ))}
        {hasMore && (
          <div
            ref={sentinelRef}
            className="flex h-8 items-center justify-center"
          >
            {loading && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
      </div>
      {footer && <div className="border-t p-1">{footer}</div>}
    </div>
  );
}
