"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserRound } from "lucide-react";
import { matchesPerson } from "@lictory/core/lib/handles";
import { cn } from "@lictory/core/lib/utils";
import { searchMembers } from "@lictory/platform/sync-legacy/engine";
import type { DirectoryMember } from "@lictory/core/contracts/protocol";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Avatar } from "@lictory/ui/primitives";
import { Popover, Picker, type PickerOption } from "@lictory/ui/popover";
import { useDebouncedCallback } from "@lictory/ui/use-debounced-callback";

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
  query: queryProp,
  hideSearch = false,
  activeIndex,
  onActiveIndexChange,
  onOptionsChange,
  listboxId,
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
  query?: string;
  hideSearch?: boolean;
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  onOptionsChange?: (options: PickerOption<string>[]) => void;
  listboxId?: string;
}) {
  const { organization, directory, userId } = useWorkspace();
  const [internalQuery, setInternalQuery] = useState("");
  const query = queryProp ?? internalQuery;
  const { members, loading, hasMore, loadMore, search } = useMemberSearch(
    organization.id,
    excludeIds,
    queryProp !== undefined,
  );
  const options = useMemo(() => {
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
  useEffect(() => {
    onOptionsChange?.(options);
  }, [onOptionsChange, options]);
  useEffect(() => {
    if (queryProp === undefined) return;
    search(queryProp);
  }, [queryProp, search]);
  return (
    <Picker
      title={hideSearch ? undefined : title}
      options={options}
      value={value}
      onSelect={onSelect}
      placeholder={placeholder}
      emptyText={emptyText}
      multiple={multiple}
      searchable
      hideSearch={hideSearch}
      loading={loading}
      hasMore={hasMore}
      activeIndex={activeIndex}
      onActiveIndexChange={onActiveIndexChange}
      listboxId={listboxId}
      onQueryChange={(next) => {
        if (queryProp === undefined) setInternalQuery(next);
        search(next);
      }}
      onEndReached={loadMore}
    />
  );
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
        <Avatar userId={userId} name={name} size="sm" />
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

function PersonCombobox({
  name,
  value,
  onSelect,
}: {
  name: string | null;
  value: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<PickerOption<string>[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const activeOption = options[active];
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);
  const choose = useCallback(
    (next: string) => {
      onSelect(next);
      close();
    },
    [close, onSelect],
  );
  const onOptionsChange = useCallback((next: PickerOption<string>[]) => {
    setOptions(next);
    setActive((current) => Math.min(current, Math.max(0, next.length - 1)));
  }, []);
  return (
    <Popover
      width={280}
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
      trigger={(props) => (
        <div
          ref={props.ref}
          data-state={props["data-state"]}
          tabIndex={-1}
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
          <input
            ref={inputRef}
            role="combobox"
            aria-label={`Assignee: ${name ?? "Unassigned"}`}
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && activeOption
                ? `${listId}-option-${activeOption.value}`
                : undefined
            }
            value={open ? query : (name ?? "")}
            placeholder={name ?? "Unassigned"}
            autoComplete="off"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            onFocus={() => {
              setQuery("");
              setActive(0);
              setOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActive((current) =>
                  Math.min(options.length - 1, current + (open ? 1 : 0)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = options[active];
                if (option) choose(option.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
                inputRef.current?.blur();
              }
            }}
          />
        </div>
      )}
    >
      <PeoplePicker
        hideSearch
        query={query}
        value={value}
        none={unassignedOption}
        listboxId={listId}
        activeIndex={active}
        onActiveIndexChange={setActive}
        onOptionsChange={onOptionsChange}
        onSelect={choose}
      />
    </Popover>
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

function useMemberSearch(
  organizationId: string,
  excludeIds?: string[],
  controlled = false,
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
  useEffect(() => {
    if (controlled) return;
    void load(true);
    return () => abortRef.current?.abort();
  }, [controlled, load]);
  const searchNow = useCallback(
    (value: string) => {
      queryRef.current = value;
      void load(true);
    },
    [load],
  );
  const search = useDebouncedCallback(searchNow, 150);
  const loadMore = useCallback(() => {
    void load(false);
  }, [load]);
  return { members, loading, hasMore, loadMore, search };
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
