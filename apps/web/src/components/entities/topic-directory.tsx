"use client";

import type { Entity } from "@lictory/contracts";
import Link from "next/link";
import * as React from "react";

import { EntityPicker } from "@/components/entities/entity-picker";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  Hash,
  Plus,
  RefreshCw,
  Search,
  X,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";
import { entityHref } from "@/lib/entities";

function noteLabel(count: number) {
  if (count === 0) return "No notes";
  return `${count} note${count === 1 ? "" : "s"}`;
}

function TopicRow({
  topic,
  rank,
  minimum,
  maximum,
}: {
  topic: Entity;
  rank: number;
  minimum: number;
  maximum: number;
}) {
  const count = topic.noteCount ?? 0;
  const share = maximum > 0 ? Math.max((count / maximum) * 100, 4) : 0;
  const prominent = maximum > minimum && count === maximum;

  return (
    <li className="min-w-0">
      <Link
        href={entityHref(topic.id)}
        aria-label={`${topic.name}, ${noteLabel(count)}`}
        className="group relative flex min-h-[4.25rem] items-center gap-3 overflow-hidden rounded-lg border border-hairline bg-surface px-3.5 py-2.5 transition-colors hover:border-[rgb(var(--entity-topic)/0.38)] hover:bg-surface-strong sm:px-4"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-[rgb(var(--entity-topic)/0.7)] to-[rgb(var(--entity-topic)/0.08)]"
          style={{ width: `${share}%` }}
        />

        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-md border font-mono text-[0.625rem] tabular-nums ${
            prominent
              ? "border-[rgb(var(--entity-topic)/0.28)] bg-[rgb(var(--entity-topic)/0.12)] text-[rgb(var(--entity-topic))]"
              : "border-hairline bg-canvas-raised text-subtle"
          }`}
        >
          {String(rank).padStart(2, "0")}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Hash
              aria-hidden
              className="size-3.5 shrink-0 text-[rgb(var(--entity-topic)/0.72)]"
            />
            <span className="truncate text-sm font-medium tracking-[-0.012em] text-foreground">
              {topic.name}
            </span>
          </div>
          <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-canvas-raised">
            <span
              aria-hidden
              className="block h-full rounded-full bg-[rgb(var(--entity-topic)/0.42)]"
              style={{ width: `${share}%` }}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pl-1">
          <span className="text-right text-[0.6875rem] tabular-nums text-subtle">
            {noteLabel(count)}
          </span>
          <ChevronRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </div>
      </Link>
    </li>
  );
}

function DirectorySkeleton() {
  return (
    <div className="grid gap-2.5 md:grid-cols-2">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-[4.25rem] rounded-lg" />
      ))}
    </div>
  );
}

export function TopicDirectory() {
  const api = useApi();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  const topics = useResource(`topics:${debounced}`, () =>
    api.listEntities({ type: "topic", q: debounced || undefined }),
  );
  const results = topics.data?.entities ?? [];
  const maximum = results.reduce(
    (current, topic) => Math.max(current, topic.noteCount ?? 0),
    0,
  );
  const minimum = results.reduce(
    (current, topic) => Math.min(current, topic.noteCount ?? 0),
    results[0]?.noteCount ?? 0,
  );
  const connections = results.reduce(
    (total, topic) => total + (topic.noteCount ?? 0),
    0,
  );

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">Topics</h1>
          <span className="border-l border-hairline pl-3 font-mono text-[0.6875rem] tabular-nums text-subtle">
            {results.length}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => setPickerOpen(true)}
          >
            <Plus />
            Add topic
          </Button>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Themes across your notes, ordered by how often they appear.
        </p>
      </header>

      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search topics…"
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

      {topics.initialLoading ? (
        <DirectorySkeleton />
      ) : topics.error ? (
        <div className="atlas-grid flex min-h-64 flex-col items-center justify-center rounded-xl border border-danger/35 bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Topics could not be loaded
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-subtle">
            {topics.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => void topics.refresh()}
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : results.length === 0 ? (
        <div className="atlas-grid rounded-xl border border-dashed border-hairline-strong px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            {debounced ? "No topics match" : "No topics yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
            {debounced
              ? "Try another phrase, or clear the search to see every topic."
              : "Topics gather here as your notes are understood. You can also add one yourself."}
          </p>
        </div>
      ) : (
        <section aria-labelledby="topic-directory-heading">
          <div className="mb-3 flex items-end justify-between gap-4 border-b border-hairline pb-3">
            <div>
              <h2
                id="topic-directory-heading"
                className="text-xs font-medium text-foreground"
              >
                {debounced ? "Matching topics" : "All topics"}
              </h2>
              <p className="mt-0.5 text-[0.6875rem] text-subtle">
                Most connected first
              </p>
            </div>
            <p className="text-[0.6875rem] tabular-nums text-subtle">
              {connections} note connection{connections === 1 ? "" : "s"}
            </p>
          </div>

          <ol className="grid gap-2.5 md:grid-cols-2">
            {results.map((topic, index) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                rank={index + 1}
                minimum={minimum}
                maximum={maximum}
              />
            ))}
          </ol>
        </section>
      )}

      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialType="topic"
        onSubmit={async (input) => {
          if (input.entity) await api.createEntity(input.entity);
          await topics.refresh();
        }}
      />
    </div>
  );
}
