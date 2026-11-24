import { Actor } from "@lictory/platform/components/identity/actor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
} from "@ui-sdk/react/combobox";
import { Check, Loader2, UserRound } from "lucide-react";
import { matchesPerson } from "@lictory/core/lib/handles";
import { cn } from "@lictory/core/lib/utils";
import { searchMembers } from "@lictory/platform/data/lookups";
import type { DirectoryMember } from "@lictory/core/contracts/protocol";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Avatar } from "@lictory/ui/primitives";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import { Popover, Picker, type PickerOption } from "@lictory/ui/popover";
import { popupContainer } from "@lictory/ui/popup";

const PAGE_SIZE = 20;

export function PeoplePicker({
  value,
  onSelect,
  title = "People",
  placeholder = "Search people…",
  emptyText = "No people match.",
  none,
  extras,
  excludeIds,
  memberValue = memberId,
  multiple = false,
}: {
  value?: string | string[] | null;
  onSelect: (value: string) => void;
  title?: string;
  placeholder?: string;
  emptyText?: string;
  none?: PickerOption<string>;
  extras?: PickerOption<string>[];
  excludeIds?: string[];
  memberValue?: (member: DirectoryMember) => string;
  multiple?: boolean;
}) {
  const { organization } = useWorkspace();
  const [query, setQuery] = useState("");
  const { members, loading, hasMore, loadMore, search } = useMemberSearch(
    organization.id,
    excludeIds,
  );
  const options = usePeopleOptions({
    members,
    query,
    value,
    none,
    extras,
    excludeIds,
    memberValue,
  });
  return (
    <Picker
      title={title}
      options={options}
      value={value}
      onSelect={onSelect}
      placeholder={placeholder}
      emptyText={emptyText}
      multiple={multiple}
      searchable
      loading={loading}
      hasMore={hasMore}
      onQueryChange={(next) => {
        setQuery(next);
        search(next);
      }}
      onEndReached={loadMore}
    />
  );
}

// What a people list offers for a query: "nobody" and other fixed choices
// first, then the chosen people the server has not returned yet, then its
// results.
function usePeopleOptions({
  members,
  query,
  value,
  none,
  extras,
  excludeIds,
  memberValue = memberId,
}: {
  members: DirectoryMember[];
  query: string;
  value?: string | string[] | null;
  none?: PickerOption<string>;
  extras?: PickerOption<string>[];
  excludeIds?: string[];
  memberValue?: (member: DirectoryMember) => string;
}) {
  const { directory, userId } = useWorkspace();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const extraOptions = (extras ?? []).filter((option) =>
      matchesQuery(option, q),
    );
    const selected = new Set(
      Array.isArray(value) ? value : value ? [value] : [],
    );
    const loaded = new Set(members.map((member) => member.id));
    const excluded = new Set(excludeIds ?? []);
    const pinned = q
      ? []
      : directory.members.filter(
          (member) =>
            !excluded.has(member.id) &&
            !loaded.has(member.id) &&
            selected.has(memberValue(member)),
        );
    return [
      ...(none && matchesQuery(none, q) ? [none] : []),
      ...extraOptions,
      ...(pinned as DirectoryMember[])
        .concat(members)
        .filter((member) => !excluded.has(member.id))
        .filter((member) => matchesMember(member, query))
        .map((member) => memberOption(member, memberValue, userId)),
    ];
  }, [
    directory.members,
    excludeIds,
    extras,
    memberValue,
    members,
    none,
    query,
    userId,
    value,
  ]);
}

export function PersonTrigger({
  name,
  userId,
  compact = false,
  unassigned = "Unassigned",
}: {
  name: string | null;
  userId?: string | null;
  compact?: boolean;
  unassigned?: string;
}) {
  return (
    <>
      {name ? (
        <Actor userId={userId} label="none" size={20} />
      ) : (
        <span className="grid size-5 place-items-center rounded-full border border-dashed text-muted-foreground">
          <UserRound className="size-3" />
        </span>
      )}
      {!compact && (
        <span className={cn(!name && "text-muted-foreground")}>
          {name ?? unassigned}
        </span>
      )}
    </>
  );
}

export function AssigneePicker({
  assigneeId,
  onChange,
  compact = false,
}: {
  assigneeId: string | null;
  onChange?: (assigneeId: string | null) => void;
  compact?: boolean;
}) {
  const { memberName } = useWorkspace();
  const name = assigneeId ? memberName(assigneeId) : null;
  const content = (
    <PersonTrigger
      userId={assigneeId}
      name={name}
      compact={compact}
      unassigned="Unassigned"
    />
  );
  if (!onChange)
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[13px]"
        title={name ?? "Unassigned"}
      >
        {content}
      </span>
    );
  if (compact)
    return (
      <Popover
        width={280}
        trigger={(props) => (
          <button
            {...props}
            aria-label={`Assignee: ${name ?? "Unassigned"}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-[13px] transition-[background-color,color] duration-100 ease-out outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {content}
          </button>
        )}
      >
        <PeoplePicker
          title="Assign to"
          value={assigneeId ?? "none"}
          none={unassignedOption}
          onSelect={(v) => onChange(v === "none" ? null : v)}
        />
      </Popover>
    );
  return (
    <PersonCombobox
      name={name}
      value={assigneeId ?? "none"}
      onSelect={(v) => onChange(v === "none" ? null : v)}
    />
  );
}

const unassignedOption: PickerOption<string> = {
  value: "none",
  label: "Unassigned",
  icon: <UserRound className="size-3.5" />,
};

// The assignee as a field: typing searches people, the list opens under it.
function PersonCombobox({
  name,
  value,
  onSelect,
}: {
  name: string | null;
  value: string;
  onSelect: (value: string) => void;
}) {
  const { organization } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { members, loading, hasMore, loadMore, search, start, reset } =
    useMemberSearch(organization.id, undefined, true);
  const options = usePeopleOptions({
    members,
    query,
    value,
    none: unassignedOption,
  });
  const empty = options.length === 0;
  const show = () => {
    if (open) return;
    setQuery("");
    setOpen(true);
    start();
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    reset();
  };
  return (
    <Combobox<string>
      container={popupContainer()}
      value={value}
      onValueChange={(next) => {
        // Deleting the text asks for no value; only a chosen row changes it.
        if (next !== null) onSelect(next);
      }}
      query={open ? query : (name ?? "")}
      onQueryChange={(next, details) => {
        if (details.reason !== "input-change") return;
        setQuery(next);
        search(next);
      }}
      open={open}
      onOpenChange={(next, details) => {
        if (next) {
          setOpen(true);
          start();
          return;
        }
        close();
        if (details.reason === "escape-key") inputRef.current?.blur();
      }}
      filter={false}
      autoHighlight="always"
      loop={false}
      status={loading ? "loading" : "idle"}
      onLoadMore={hasMore ? loadMore : undefined}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer convenience that focuses the field's own input, which keyboard users reach directly. */}
      <div
        ref={setField}
        data-state={open ? "open" : "closed"}
        className="flex h-7 w-full min-w-0 cursor-text items-center gap-1.5 rounded-md px-1.5 transition-[background-color,box-shadow] duration-100 ease-out focus-within:bg-muted focus-within:ring-2 focus-within:ring-ring/60 hover:bg-muted"
        onMouseDown={(event) => {
          if (event.target === inputRef.current) return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <PersonTrigger
          userId={value === "none" ? null : value}
          name={name}
          compact
          unassigned="Unassigned"
        />
        <ComboboxInput
          ref={inputRef}
          aria-label={`Assignee: ${name ?? "Unassigned"}`}
          placeholder={name ?? "Unassigned"}
          autoComplete="off"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground touch:text-base"
          onFocus={show}
          onClick={show}
          onKeyDown={(event) => {
            // Enter with nothing to choose must not submit a surrounding form.
            if (event.key === "Enter" && (!open || empty))
              event.preventDefault();
            if (event.key === "Escape" && !open) inputRef.current?.blur();
          }}
        />
      </div>
      <ComboboxContent
        data-popover
        anchor={field}
        align="start"
        sideOffset={4}
        collisionPadding={8}
        style={{ width: 280, maxHeight: "var(--available-height)" }}
        className={cn(dropdownContentClass, "flex min-w-0 flex-col")}
      >
        <ComboboxEmpty className="text-center text-xs text-muted-foreground data-empty:px-2 data-empty:py-3">
          {loading ? "Searching…" : "No people match."}
        </ComboboxEmpty>
        <ComboboxList
          aria-label="People"
          className={cn(
            "max-h-72 min-h-0 flex-1 overflow-y-auto p-1 outline-none",
            empty && "hidden",
          )}
        >
          {options.map((option) => (
            <ComboboxItem
              key={option.value}
              value={option.value}
              label={option.label}
              className={dropdownItemClass}
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
              <ComboboxItemIndicator className="flex shrink-0">
                <Check className="size-3.5 text-primary" aria-hidden />
              </ComboboxItemIndicator>
            </ComboboxItem>
          ))}
          {hasMore && (
            <div
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
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function memberId(member: DirectoryMember) {
  return member.id;
}

function memberOption(
  member: DirectoryMember,
  memberValue: (member: DirectoryMember) => string,
  userId: string,
): PickerOption<string> {
  return {
    value: memberValue(member),
    label: member.id === userId ? `${member.name} (me)` : member.name,
    hint: member.handle ? `@${member.handle}` : member.email,
    keywords: `${member.name} ${member.handle ? `@${member.handle}` : ""} ${member.email}`,
    icon: <Avatar image={member.image} name={member.name} size="xs" />,
  };
}

// Pages of people for a query. A `manual` search loads nothing until
// `start()` (a list opening) and forgets its results at `reset()`.
function useMemberSearch(
  organizationId: string,
  excludeIds?: string[],
  manual = false,
) {
  const { userId, directory } = useWorkspace();
  const excluded = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const queryRef = useRef("");
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef(!manual);
  const timerRef = useRef<number | undefined>(undefined);
  const load = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current && !reset) return;
      if (!reset && !hasMoreRef.current) return;
      const request = ++requestRef.current;
      loadingRef.current = true;
      setLoading(true);
      const offset = reset ? 0 : offsetRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const page = await searchMembers(
          organizationId,
          queryRef.current,
          offset,
          PAGE_SIZE,
          controller.signal,
        );
        if (request !== requestRef.current) return;
        const next = page.members.filter((member) => !excluded.has(member.id));
        offsetRef.current = offset + page.members.length;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setMembers((current) => (reset ? next : mergeMembers(current, next)));
      } catch (error) {
        if (request !== requestRef.current) return;
        if (error instanceof Error && error.name === "AbortError") return;
        hasMoreRef.current = false;
        setHasMore(false);
        if (reset) {
          const fallback = directory.members
            .filter((member) => !excluded.has(member.id))
            .filter((member) => matchesMember(member, queryRef.current))
            .sort((a, b) => compareMembers(a, b, userId))
            .slice(offset, offset + PAGE_SIZE);
          setMembers(fallback);
          setHasMore(false);
          hasMoreRef.current = false;
        }
      } finally {
        if (request === requestRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [directory.members, excluded, organizationId, userId],
  );
  // A search waiting out its pause runs the loader of the moment it fires:
  // the people to leave out may have changed meanwhile.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    if (manual) return;
    void load(true);
    return () => abortRef.current?.abort();
  }, [manual, load]);
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );
  const search = useCallback((value: string) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!liveRef.current) return;
      queryRef.current = value;
      void loadRef.current(true);
    }, 150);
  }, []);
  const loadMore = useCallback(() => {
    void load(false);
  }, [load]);
  const start = useCallback(() => {
    if (liveRef.current) return;
    liveRef.current = true;
    void load(true);
  }, [load]);
  const reset = useCallback(() => {
    liveRef.current = false;
    window.clearTimeout(timerRef.current);
    requestRef.current += 1;
    abortRef.current?.abort();
    loadingRef.current = false;
    hasMoreRef.current = false;
    queryRef.current = "";
    setMembers([]);
    setLoading(true);
    setHasMore(false);
  }, []);
  return { members, loading, hasMore, loadMore, search, start, reset };
}

function mergeMembers(current: DirectoryMember[], next: DirectoryMember[]) {
  const seen = new Set(current.map((member) => member.id));
  return [...current, ...next.filter((member) => !seen.has(member.id))];
}

function matchesQuery(option: PickerOption<string>, query: string) {
  if (!query) return true;
  return (
    option.label.toLowerCase().includes(query) ||
    (option.hint?.toLowerCase().includes(query) ?? false) ||
    (option.keywords?.toLowerCase().includes(query) ?? false)
  );
}

function matchesMember(member: DirectoryMember, query: string) {
  return matchesPerson(member, query);
}

function compareMembers(
  a: DirectoryMember,
  b: DirectoryMember,
  userId: string,
) {
  if (a.id === userId) return -1;
  if (b.id === userId) return 1;
  return a.name.localeCompare(b.name) || a.email.localeCompare(b.email);
}
