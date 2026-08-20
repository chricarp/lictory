"use client";

import type { NoteStatus } from "@lictory/contracts";
import { AnimatePresence, motion } from "motion/react";
import { Search, X } from "@/components/ui/icons";
import * as React from "react";

import { NoteCard, NoteCardSkeleton } from "@/components/notes/note-card";
import { Input } from "@/components/ui/input";
import { useApi, useResource } from "@/lib/api";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ value: NoteStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "failed", label: "Attention" },
];

export function NotesFeed() {
  const api = useApi();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [status, setStatus] = React.useState<NoteStatus | "all">("all");

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  const key = `notes:${status}:${debounced}`;
  const notes = useResource(
    key,
    () =>
      api.listNotes({
        limit: 40,
        q: debounced || undefined,
        status: status === "all" ? undefined : status,
      }),
    { refreshInterval: 6_000 },
  );

  const results = notes.data?.notes ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <h1 className="text-3xl font-semibold tracking-[-0.035em]">Notes</h1>
        <span className="mb-1 border-l border-hairline-strong pl-3 font-mono text-[0.6875rem] tabular-nums text-subtle">
          {results.length}
        </span>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your notes…"
            className="pl-9 pr-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                status === filter.value
                  ? "border-[rgb(var(--ember)/0.4)] bg-[rgb(var(--ember)/0.12)] text-ember-bright"
                  : "border-hairline text-subtle hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {notes.initialLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <NoteCardSkeleton key={index} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-16 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            {debounced ? `Nothing matches “${debounced}”` : "No notes here yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
            {debounced
              ? "Try a person, a place or a word from the note."
              : "Capture a thought and it will show up here."}
          </p>
        </motion.div>
      ) : (
        <motion.div layout className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {results.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
