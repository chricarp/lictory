"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { KindIcon } from "~/components/items/icons";
import { Picker, Popover, type PickerOption } from "~/components/ui/popover";
import { useDebouncedCallback } from "~/components/ui/use-debounced-callback";
import { useWorkspace } from "~/components/workspace/provider";
import { cn } from "~/lib/utils";
import { searchEpics } from "~/sync/client/engine";
import type { EpicSummary } from "~/sync/shared/protocol";

const PAGE_SIZE = 20;
const noEpicOption: PickerOption<string> = {
  value: "none",
  label: "No epic",
};

export function EpicPicker({
  parentId,
  projectId,
  projectKey,
  selected,
  onChange,
  className,
}: {
  parentId: string | null;
  projectId: string;
  projectKey?: string;
  selected?: EpicSummary;
  onChange: (parentId: string | null) => void;
  className?: string;
}) {
  const [chosen, setChosen] = useState<EpicSummary>();
  const current =
    chosen?.id === parentId
      ? chosen
      : selected?.id === parentId
        ? selected
        : undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [options, setOptions] = useState<PickerOption<string>[]>([]);
  const [loaded, setLoaded] = useState<EpicSummary[]>([]);
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
      const epic = loaded.find((candidate) => candidate.id === next);
      setChosen(epic);
      onChange(next === "none" ? null : next);
      close();
    },
    [close, loaded, onChange],
  );
  const onOptionsChange = useCallback((next: PickerOption<string>[]) => {
    setOptions(next);
    setActive((currentIndex) =>
      Math.min(currentIndex, Math.max(0, next.length - 1)),
    );
  }, []);
  const name = current?.title;
  const identifier = current
    ? `${projectKey ? `${projectKey}-` : ""}${current.number}`
    : undefined;

  return (
    <Popover
      width={320}
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
          className={cn(
            "flex h-9 w-full min-w-0 cursor-text items-center gap-2 rounded-md border bg-card px-2.5 transition-[border-color,box-shadow] duration-100 ease-out focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10 hover:border-foreground/20",
            className,
          )}
          onMouseDown={(event) => {
            if (event.target === inputRef.current) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
            <KindIcon kind="epic" />
          </span>
          <input
            ref={inputRef}
            role="combobox"
            aria-label={`Epic: ${name ?? "None"}`}
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
            placeholder="Search for an epic…"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
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
                setActive((currentIndex) =>
                  Math.min(options.length - 1, currentIndex + (open ? 1 : 0)),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((currentIndex) => Math.max(0, currentIndex - 1));
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
          {identifier && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {identifier}
            </span>
          )}
        </div>
      )}
    >
      <EpicOptions
        projectId={projectId}
        projectKey={projectKey}
        query={query}
        value={parentId ?? "none"}
        selected={current}
        listboxId={listId}
        activeIndex={active}
        onActiveIndexChange={setActive}
        onOptionsChange={onOptionsChange}
        onEpicsChange={setLoaded}
        onSelect={choose}
      />
    </Popover>
  );
}

function EpicOptions({
  projectId,
  projectKey,
  query,
  value,
  selected,
  listboxId,
  activeIndex,
  onActiveIndexChange,
  onOptionsChange,
  onEpicsChange,
  onSelect,
}: {
  projectId: string;
  projectKey?: string;
  query: string;
  value: string;
  selected?: EpicSummary;
  listboxId: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onOptionsChange: (options: PickerOption<string>[]) => void;
  onEpicsChange: (epics: EpicSummary[]) => void;
  onSelect: (value: string) => void;
}) {
  const { organization } = useWorkspace();
  const { epics, loading, hasMore, loadMore, search } = useEpicSearch(
    organization.id,
    projectId,
  );
  const options = useMemo(() => {
    const loadedIds = new Set(epics.map((epic) => epic.id));
    const pinned =
      !query && selected && !loadedIds.has(selected.id) ? [selected] : [];
    return [
      ...(!query || "no epic".includes(query.trim().toLowerCase())
        ? [noEpicOption]
        : []),
      ...pinned.concat(epics).map((epic) => ({
        value: epic.id,
        label: epic.title,
        hint: `${projectKey ? `${projectKey}-` : ""}${epic.number}`,
        icon: <KindIcon kind="epic" />,
      })),
    ];
  }, [epics, projectKey, query, selected]);
  useEffect(() => {
    onOptionsChange(options);
    onEpicsChange(selected ? mergeEpics([selected], epics) : epics);
  }, [epics, onEpicsChange, onOptionsChange, options, selected]);
  useEffect(() => {
    search(query);
  }, [query, search]);
  return (
    <Picker
      options={options}
      value={value}
      onSelect={onSelect}
      emptyText="No epics match."
      searchable
      hideSearch
      loading={loading}
      hasMore={hasMore}
      activeIndex={activeIndex}
      onActiveIndexChange={onActiveIndexChange}
      listboxId={listboxId}
      onEndReached={loadMore}
    />
  );
}

function useEpicSearch(organizationId: string, projectId: string) {
  const [epics, setEpics] = useState<EpicSummary[]>([]);
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
        const page = await searchEpics(
          organizationId,
          projectId,
          queryRef.current,
          offset,
          PAGE_SIZE,
          controller.signal,
        );
        if (request !== requestRef.current) return;
        offsetRef.current = offset + page.epics.length;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setEpics((current) =>
          reset ? page.epics : mergeEpics(current, page.epics),
        );
      } catch (error) {
        if (request !== requestRef.current) return;
        if (error instanceof Error && error.name === "AbortError") return;
        hasMoreRef.current = false;
        setHasMore(false);
        if (reset) setEpics([]);
      } finally {
        if (request === requestRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [organizationId, projectId],
  );
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
  useEffect(() => () => abortRef.current?.abort(), []);
  return { epics, loading, hasMore, loadMore, search };
}

function mergeEpics(current: EpicSummary[], next: EpicSummary[]) {
  const seen = new Set(current.map((epic) => epic.id));
  return [...current, ...next.filter((epic) => !seen.has(epic.id))];
}
