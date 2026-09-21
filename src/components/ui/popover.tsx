"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Search } from "lucide-react";
import { cn } from "~/lib/utils";

// Lightweight popover primitive: click/Enter opens, Escape or outside-click
// closes, focus returns to the trigger. Portaled to <body> and positioned near the
// trigger, flipping when it would leave the viewport.
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
  const setTriggerNode = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width?: number;
    maxHeight: number;
  }>();
  const labelId = useId();
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, [setOpen]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const gap = 6;
      const panelWidth = width === "trigger" ? anchor.width : width;
      const height = panel.offsetHeight;
      let top =
        side === "top" ? anchor.top - gap - height : anchor.bottom + gap;
      let left =
        side === "right"
          ? anchor.right + gap
          : align === "end"
            ? anchor.right - panelWidth
            : anchor.left;
      if (side === "right") top = anchor.top;
      if (side === "bottom" && top + height > window.innerHeight - 8)
        top = Math.max(8, anchor.top - gap - height);
      if (top < 8) top = 8;
      left = Math.min(Math.max(8, left), window.innerWidth - panelWidth - 8);
      setPosition({
        top,
        left,
        width: panelWidth,
        maxHeight: Math.max(160, window.innerHeight - top - 8),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, side, width]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      // Nested popovers are portaled siblings in the DOM; a click inside any
      // popover panel must not dismiss the one that opened it.
      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target) ||
        (target instanceof Element && target.closest("[data-popover]"))
      )
        return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close, setOpen]);
  return (
    <>
      {/* Render prop receives a callback ref for the trigger element. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {trigger({
        "data-state": open ? "open" : "closed",
        onClick: () => {
          if (disabled) return;
          setOpen(!open);
        },
        ref: setTriggerNode,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        disabled,
      })}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <PopoverContext.Provider value={{ close, labelId }}>
            <div
              ref={panelRef}
              data-popover
              role="dialog"
              aria-labelledby={labelId}
              style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                width: position?.width,
                maxHeight: position?.maxHeight,
              }}
              className={cn(
                "fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-[var(--shadow-panel)]",
                position ? "animate-in" : "invisible",
                className,
              )}
            >
              {/* eslint-disable-next-line react-hooks/refs */}
              {typeof children === "function" ? children(close) : children}
            </div>
          </PopoverContext.Provider>,
          document.body,
        )}
    </>
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
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const choose = (option: PickerOption<T>) => {
    onSelect(option.value);
    if (!multiple) popover?.close();
  };
  return (
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
          className="px-3 pt-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
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
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
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
        className="max-h-72 min-h-0 flex-1 overflow-y-auto p-1"
      >
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            {loading ? "Searching…" : emptyText}
          </p>
        )}
        {filtered.map((option, index) => (
          <button
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
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none",
              index === active && "bg-muted",
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
          </button>
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
