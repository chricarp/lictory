"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import {
  Listbox,
  ListboxItem,
  ListboxItemIndicator,
} from "@ui-sdk/react/listbox";
import {
  createPopoverController,
  Popover as PopoverPrimitive,
  PopoverContent,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import {
  dropdownContentClass,
  dropdownItemClass,
  DropdownItem,
} from "@lictory/ui/dropdown";
import { ownName } from "@lictory/ui/named";
import { popupContainer } from "@lictory/ui/popup";
import { Check, Loader2, Search } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";

// Shared surface for searchable dropdowns and contextual panels.
type PopoverContextValue = { close: () => void; labelId: string };
const PopoverContext = createContext<PopoverContextValue | null>(null);
export const usePopover = () => useContext(PopoverContext);

// What a trigger element receives: spread it on a button, or take only `ref`
// to anchor the panel to something that is not a button.
export type PopoverTriggerProps = Omit<ComponentProps<"button">, "ref"> & {
  "data-state": "open" | "closed";
  ref: (node: HTMLElement | null) => void;
};

function assign(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === "function") return ref(node);
  if (ref) ref.current = node;
}

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  width = 240,
  open,
  onOpenChange,
  disabled,
  className,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  side?: "bottom" | "top" | "right";
  width?: number | "trigger";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [controller] = useState(() => createPopoverController());
  const labelId = useId();
  const close = useCallback(() => {
    controller.close();
  }, [controller]);
  // One callback for the trigger's life, so callers can compose it with
  // their own ref without detaching the trigger on every render.
  const partRef = useRef<Ref<HTMLElement>>(undefined);
  const detach = useRef<(() => void) | void>(undefined);
  const triggerRef = useCallback((node: HTMLElement | null) => {
    if (detach.current) detach.current();
    else if (!node) assign(partRef.current, null);
    detach.current = node ? assign(partRef.current, node) : undefined;
  }, []);
  return (
    <PopoverPrimitive
      open={open}
      onOpenChange={onOpenChange && ((next) => onOpenChange(next))}
      controller={controller}
      container={popupContainer()}
    >
      <PopoverTrigger
        disabled={disabled}
        render={({ ref, ...props }, state) => {
          partRef.current = ref as Ref<HTMLElement>;
          return (
            <>
              {trigger({
                ...props,
                ref: triggerRef,
                "data-state": state.open ? "open" : "closed",
              })}
            </>
          );
        }}
      />
      <PopoverContent
        data-popover
        aria-labelledby={labelId}
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        style={{
          width: width === "trigger" ? "var(--anchor-width)" : width,
          maxHeight: "var(--available-height)",
        }}
        className={cn(dropdownContentClass, "flex flex-col", className)}
      >
        <PopoverContext value={{ close, labelId }}>
          {typeof children === "function" ? children(close) : children}
        </PopoverContext>
      </PopoverContent>
    </PopoverPrimitive>
  );
}

export type PickerOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  keywords?: string;
};

type PickerProps<T extends string> = {
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
};

const titleClass =
  "px-3 pt-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase";
const listClass = "max-h-72 min-h-0 flex-1 overflow-y-auto p-1 outline-none";

function OptionRow<T extends string>({ option }: { option: PickerOption<T> }) {
  return (
    <>
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
    </>
  );
}

// An option's value may be an empty string, which a list cannot key on.
const key = (value: string) => `value:${value}`;
const unkey = <T extends string>(value: string) =>
  value.slice("value:".length) as T;

// A list of choices inside a popover, searchable once it is long or loads its
// options from the server. Choosing one closes the popover unless `multiple`.
export function Picker<T extends string>(props: PickerProps<T>) {
  const {
    options,
    value,
    onSelect,
    multiple = false,
    title,
    footer,
    searchable,
    hideSearch = false,
    onQueryChange,
  } = props;
  const popover = usePopover();
  const showSearch =
    !hideSearch &&
    (searchable ?? (options.length > 6 || Boolean(onQueryChange)));
  const selected = new Set(
    Array.isArray(value)
      ? value
      : value !== undefined && value !== null
        ? [value]
        : [],
  );
  const choose = (chosen: T) => {
    onSelect(chosen);
    if (!multiple) popover?.close();
  };
  return (
    <div className="flex min-h-0 flex-col">
      {title && (
        <div
          id={hideSearch ? undefined : popover?.labelId}
          className={titleClass}
        >
          {title}
        </div>
      )}
      {showSearch ? (
        <SearchList {...props} selected={selected} choose={choose} />
      ) : (
        <PlainList {...props} selected={selected} choose={choose} />
      )}
      {footer && <div className="border-t p-1">{footer}</div>}
    </div>
  );
}

// Asks for the next page once the end of a list is in view. The marker at its
// end is watched instead of the highlighted option, so a new search starts
// paging afresh and a page whose people were all filtered out, which leaves no
// option to reach, still continues.
function useEndReached(
  list: RefObject<HTMLElement | null>,
  end: RefObject<HTMLElement | null>,
  {
    hasMore,
    loading,
    onEndReached,
    count,
  }: {
    hasMore: boolean;
    loading: boolean;
    onEndReached?: () => void;
    count: number;
  },
) {
  useEffect(() => {
    if (!onEndReached || !hasMore || loading) return;
    const root = list.current;
    const marker = end.current;
    if (!root || !marker) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onEndReached();
      },
      { root, rootMargin: "64px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [list, end, onEndReached, hasMore, loading, count]);
}

type ListProps<T extends string> = PickerProps<T> & {
  selected: Set<T>;
  choose: (value: T) => void;
};

function SearchList<T extends string>({
  options,
  placeholder = "Filter…",
  emptyText = "No matches.",
  title,
  loading = false,
  hasMore = false,
  onQueryChange,
  onEndReached,
  selected,
  choose,
}: ListProps<T>) {
  const popover = usePopover();
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEndReached(listRef, endRef, {
    hasMore,
    loading,
    onEndReached,
    count: options.length,
  });
  return (
    <Command
      className="flex min-h-0 flex-col"
      // Server-side searches arrive already filtered and ranked.
      filter={onQueryChange ? false : "contains"}
      status={loading ? "loading" : "idle"}
      onQueryChange={onQueryChange && ((query) => onQueryChange(query))}
      onAction={(chosen) => choose(unkey<T>(chosen))}
      // The result count would be spoken from a status region that outlives
      // the popover; the visible list is the feedback here.
      announcement={() => null}
    >
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <CommandInput
          placeholder={placeholder}
          aria-label={title ?? placeholder}
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-placeholder touch:text-base"
        />
      </div>
      <CommandList
        ref={listRef}
        id={title ? undefined : popover?.labelId}
        aria-label={title ?? placeholder}
        render={ownName}
        className={listClass}
      >
        <CommandEmpty className="text-center text-xs text-muted-foreground data-empty:px-2 data-empty:py-3">
          {loading ? "Searching…" : emptyText}
        </CommandEmpty>
        {options.map((option) => (
          <CommandItem
            key={option.value}
            value={key(option.value)}
            label={option.label}
            keywords={[option.keywords, option.hint].filter(
              (word): word is string => Boolean(word),
            )}
            aria-checked={selected.has(option.value)}
            className={dropdownItemClass}
          >
            <OptionRow option={option} />
            {selected.has(option.value) && (
              <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
            )}
          </CommandItem>
        ))}
        {hasMore && (
          <div
            ref={endRef}
            role="presentation"
            className="flex h-8 items-center justify-center"
          >
            {loading && (
              <Loader2
                className="size-3.5 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
        )}
      </CommandList>
    </Command>
  );
}

function PlainList<T extends string>({
  options,
  placeholder = "Filter…",
  emptyText = "No matches.",
  multiple = false,
  title,
  loading = false,
  hasMore = false,
  onEndReached,
  selected,
  choose,
}: ListProps<T>) {
  const popover = usePopover();
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEndReached(listRef, sentinelRef, {
    hasMore,
    loading,
    onEndReached,
    count: options.length,
  });
  const current = [...selected].map(key);
  return (
    <>
      {options.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
          {loading ? "Searching…" : emptyText}
        </p>
      )}
      <Listbox<string, boolean>
        ref={listRef}
        id={title ? undefined : popover?.labelId}
        aria-label={title ?? placeholder}
        multiple={multiple}
        activation="manual"
        // Pressing the chosen option again still reports it, so a single
        // choice can be confirmed and the popover closed.
        deselectable
        value={multiple ? current : (current[0] ?? null)}
        onValueChange={(next: string | string[] | null) => {
          if (Array.isArray(next)) {
            // Select all and Shift ranges change several options in one go.
            // Choosing here is one option at a time, and what a choice does
            // is the caller's (a command, a toggle over its own list), so a
            // bulk change is left alone rather than half applied.
            const changed = [
              ...next.filter((item) => !current.includes(item)),
              ...current.filter((item) => !next.includes(item)),
            ];
            if (changed.length === 1) choose(unkey<T>(changed[0]!));
          } else {
            const chosen = next ?? current[0];
            if (chosen) choose(unkey<T>(chosen));
          }
        }}
        className={cn(listClass, options.length === 0 && "hidden")}
      >
        {options.map((option) => (
          <ListboxItem
            key={option.value}
            value={key(option.value)}
            label={option.label}
            className={dropdownItemClass}
          >
            <OptionRow option={option} />
            <ListboxItemIndicator>
              <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
            </ListboxItemIndicator>
          </ListboxItem>
        ))}
        {hasMore && (
          <div
            ref={sentinelRef}
            role="presentation"
            className="flex h-8 items-center justify-center"
          >
            {loading && (
              <Loader2
                className="size-3.5 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
        )}
      </Listbox>
    </>
  );
}

export { DropdownItem };
