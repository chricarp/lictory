import { useCallback, useEffect, useRef, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
} from "@ui-sdk/react/combobox";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { Check, Layers, Loader2 } from "lucide-react";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import { popupContainer } from "@lictory/ui/popup";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { cn } from "@lictory/core/lib/utils";
import { searchEpics } from "@lictory/platform/data/lookups";
import type { EpicSummary } from "@lictory/core/contracts/protocol";

const PAGE_SIZE = 20;
const NO_PARENT = "none";

export function EpicPicker({
  parentId,
  projectId,
  projectKey,
  childTypeId,
  selected,
  onChange,
  className,
}: {
  parentId: string | null;
  projectId: string;
  projectKey?: string;
  childTypeId?: string;
  selected?: EpicSummary;
  onChange: (parentId: string | null) => void;
  className?: string;
}) {
  const { organization } = useWorkspace();
  const [chosen, setChosen] = useState<EpicSummary>();
  const current =
    chosen?.id === parentId
      ? chosen
      : selected?.id === parentId
        ? selected
        : undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { epics, loading, hasMore, loadMore, error, retry, reset } =
    useEpicSearch(organization.id, projectId, childTypeId, open ? query : null);
  const show = () => {
    if (open) return;
    setQuery("");
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
    reset();
  };
  const pinned =
    !query && current && !epics.some((epic) => epic.id === current.id)
      ? [current]
      : [];
  const parents = pinned.concat(epics);
  const offersNone = !query || "no parent".includes(query.trim().toLowerCase());
  const empty = parents.length === 0 && !offersNone;
  const identify = (epic: EpicSummary) =>
    `${projectKey ? `${projectKey}-` : ""}${epic.number}`;
  const name = current?.title;

  return (
    <Combobox<string>
      container={popupContainer()}
      value={parentId ?? NO_PARENT}
      onValueChange={(next) => {
        // Deleting the text asks for no value; only a chosen row changes it.
        if (next === null) return;
        setChosen(parents.find((epic) => epic.id === next));
        onChange(next === NO_PARENT ? null : next);
      }}
      query={open ? query : (name ?? "")}
      onQueryChange={(next, details) => {
        if (details.reason === "input-change") setQuery(next);
      }}
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
      filter={false}
      autoHighlight="always"
      status={error ? "error" : loading ? "loading" : "idle"}
      onLoadMore={hasMore ? loadMore : undefined}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer convenience that focuses the field's own input, which keyboard users reach directly. */}
      <div
        ref={setField}
        data-state={open ? "open" : "closed"}
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
          <ParentTypeIcon typeId={current?.typeId} />
        </span>
        <ComboboxInput
          ref={inputRef}
          aria-label={`Parent: ${name ?? "None"}`}
          placeholder="Search for a parent…"
          autoComplete="off"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ellipsis outline-none placeholder:text-muted-foreground touch:text-base"
          onFocus={show}
          onClick={show}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              // Ends the search only: the dialog or panel around the field
              // must not take the same key as a request to close.
              event.preventDefault();
              event.stopPropagation();
              close();
              inputRef.current?.blur();
            } else if (event.key === "Enter" && (!open || empty)) {
              // Enter with nothing to choose must not submit a surrounding form.
              event.preventDefault();
            }
          }}
        />
        {current && (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {identify(current)}
          </span>
        )}
      </div>
      <ComboboxContent
        data-popover
        anchor={field}
        align="start"
        sideOffset={4}
        collisionPadding={8}
        style={{ width: 320, maxHeight: "var(--available-height)" }}
        className={cn(dropdownContentClass, "flex min-w-0 flex-col")}
      >
        <ComboboxEmpty className="text-center text-xs text-muted-foreground data-empty:px-2 data-empty:py-3">
          {loading ? "Searching…" : (error ?? "No parent items match.")}
        </ComboboxEmpty>
        <ComboboxList
          className={cn(
            "max-h-72 min-h-0 flex-1 overflow-y-auto p-1 outline-none",
            empty && "hidden",
          )}
        >
          {offersNone && (
            <ComboboxItem
              value={NO_PARENT}
              label="No parent"
              className={dropdownItemClass}
            >
              <span className="min-w-0 flex-1 truncate">No parent</span>
              <Chosen />
            </ComboboxItem>
          )}
          {parents.map((epic) => (
            <ComboboxItem
              key={epic.id}
              value={epic.id}
              label={epic.title}
              className={dropdownItemClass}
            >
              <span className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                <ParentTypeIcon typeId={epic.typeId} />
              </span>
              <span className="min-w-0 flex-1 truncate">{epic.title}</span>
              <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                {identify(epic)}
              </span>
              <Chosen />
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
        {error && (
          <button
            type="button"
            // Keeps focus in the input, so the list stays open.
            onMouseDown={(event) => event.preventDefault()}
            onClick={retry}
            className="w-full border-t px-3 py-2 text-left text-xs text-primary hover:bg-muted"
          >
            Retry loading parents
          </button>
        )}
      </ComboboxContent>
    </Combobox>
  );
}

function Chosen() {
  return (
    <ComboboxItemIndicator className="flex shrink-0">
      <Check className="size-3.5 text-primary" aria-hidden />
    </ComboboxItemIndicator>
  );
}

// Searches while `query` is a string; `null` (the list is closed) loads nothing.
function useEpicSearch(
  organizationId: string,
  projectId: string,
  childTypeId: string | undefined,
  query: string | null,
) {
  const [epics, setEpics] = useState<EpicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string>();
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
      setError(undefined);
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
          childTypeId,
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
        setError("Parent items could not be loaded.");
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
    [organizationId, projectId, childTypeId],
  );
  useEffect(() => {
    if (query === null) return;
    const timer = window.setTimeout(() => {
      queryRef.current = query;
      void load(true);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query, load]);
  const reset = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    loadingRef.current = false;
    hasMoreRef.current = false;
    setEpics([]);
    setLoading(true);
    setHasMore(false);
    setError(undefined);
  }, []);
  const loadMore = useCallback(() => {
    void load(false);
  }, [load]);
  useEffect(() => () => abortRef.current?.abort(), []);
  return {
    epics,
    loading,
    hasMore,
    loadMore,
    error,
    retry: () => void load(true),
    reset,
  };
}

function mergeEpics(current: EpicSummary[], next: EpicSummary[]) {
  const seen = new Set(current.map((epic) => epic.id));
  return [...current, ...next.filter((epic) => !seen.has(epic.id))];
}

function ParentTypeIcon({ typeId }: { typeId?: string }) {
  const { delivery } = useWorkspace();
  const type = typeId ? delivery.types.get(typeId) : undefined;
  return type ? <TypeIcon type={type} /> : <Layers className="size-3.5" />;
}
