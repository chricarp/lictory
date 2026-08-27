"use client";

import type { Entity } from "@lictory/contracts";
import { AnimatePresence, motion } from "motion/react";
import { Hash, Plus, Sparkles, X } from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import { EntityPicker } from "@/components/entities/entity-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";
import { entityHref } from "@/lib/entities";
import { cn } from "@/lib/utils";

/**
 * Topics are the hashtags of the graph, so the page is a weighted stream of
 * tags rather than a directory of rows. Repetition is the signal: a theme that
 * keeps coming back renders large and bright, one mentioned once recedes. The
 * stream stays alphabetical so a tag you remember by name is findable by eye.
 */

function weightRank(
  count: number,
  total: number,
): { className: string; share: number } {
  const share = total > 0 ? count / total : 0;
  if (count >= 10 || share >= 0.12) {
    return {
      share,
      className:
        "text-2xl sm:text-3xl font-semibold text-foreground border-[rgb(var(--entity-topic)/0.5)] bg-[rgb(var(--entity-topic)/0.14)] shadow-[0_0_28px_rgb(var(--entity-topic)/0.16)]",
    };
  }
  if (count >= 5 || share >= 0.06) {
    return {
      share,
      className:
        "text-xl sm:text-2xl font-semibold text-foreground/95 border-[rgb(var(--entity-topic)/0.32)] bg-[rgb(var(--entity-topic)/0.08)]",
    };
  }
  if (count >= 2 || share >= 0.025) {
    return {
      share,
      className:
        "text-base font-medium text-foreground/80 border-hairline bg-surface-strong",
    };
  }
  return {
    share,
    className: "text-sm font-medium text-subtle border-hairline bg-transparent",
  };
}

function TopicTag({ entity, total }: { entity: Entity; total: number }) {
  const count = entity.noteCount ?? 0;
  const rank = weightRank(count, total);
  const ai = entity.origin === "ai";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
      className="min-w-0"
    >
      <Link
        href={entityHref(entity.id)}
        title={`${count} note${count === 1 ? "" : "s"}`}
        className={cn(
          "group inline-flex max-w-full items-baseline gap-2 rounded-full border px-3.5 py-1.5 tracking-tight",
          "transition-[transform,border-color,background-color,box-shadow] duration-200",
          "hover:-translate-y-0.5 hover:border-[rgb(var(--entity-topic)/0.65)] hover:bg-[rgb(var(--entity-topic)/0.16)] hover:shadow-[0_6px_24px_rgb(var(--entity-topic)/0.18)] hover:brightness-110",
          "active:translate-y-0 active:scale-[0.98]",
          rank.className,
        )}
      >
        <span className="shrink-0 self-center font-normal text-[rgb(var(--entity-topic))] opacity-70">
          #
        </span>
        <span className="truncate">{entity.name}</span>
        <span className="shrink-0 self-center font-mono text-[0.6875rem] tabular-nums leading-none opacity-55">
          {count}
        </span>
        {ai ? (
          <Sparkles
            aria-label="Found by AI"
            className="size-3 shrink-0 self-center text-[rgb(var(--entity-topic))] opacity-60"
          />
        ) : null}
      </Link>
    </motion.li>
  );
}

export function TopicsPage() {
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

  // Counts drive the weighting, so sort A–Z on the client after the server
  // ranks by recurrence.
  const all = React.useMemo(
    () =>
      [...(topics.data?.entities ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [topics.data],
  );
  const totalNotes = React.useMemo(
    () => all.reduce((sum, entity) => sum + (entity.noteCount ?? 0), 0),
    [all],
  );
  const recurring = React.useMemo(
    () => all.filter((entity) => (entity.noteCount ?? 0) > 1).length,
    [all],
  );

  const filtering = debounced.length > 0;

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-8">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">Topics</h1>
          <span className="border-l border-hairline pl-3 font-mono text-[0.6875rem] tabular-nums text-subtle">
            {all.length}
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
          The hashtags of your notes. The more a theme comes back, the louder it
          shows up — pick one to open everything under it.
        </p>
      </header>

      {/* A bare hashtag prompt instead of a boxed field: the filter itself
          reads as a tag. */}
      <div className="mb-8 flex items-center gap-2.5 border-b border-hairline pb-3 transition-colors focus-within:border-[rgb(var(--entity-topic)/0.6)]">
        <Hash className="size-4 shrink-0 text-[rgb(var(--entity-topic))] opacity-70" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="filter topics…"
          aria-label="Filter topics"
          className="min-w-0 flex-1 bg-transparent text-lg tracking-tight text-foreground outline-none placeholder:text-subtle"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear filter"
            className="shrink-0 text-subtle transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {topics.initialLoading ? (
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-3">
          {[3, 1, 2, 0, 2, 1, 0, 3, 1, 2, 0, 1].map((rank, index) => (
            <Skeleton
              key={index}
              className={cn(
                "rounded-full",
                rank === 3
                  ? "h-10 w-44"
                  : rank === 2
                    ? "h-9 w-32"
                    : rank === 1
                      ? "h-8 w-24"
                      : "h-7 w-16",
              )}
            />
          ))}
        </div>
      ) : topics.error ? (
        <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            Topics could not be loaded
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
            {topics.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => void topics.refresh()}
          >
            Try again
          </Button>
        </div>
      ) : all.length === 0 ? (
        filtering ? (
          <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">
              No topic matches “{debounced}”
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
              Try a shorter fragment, or clear the filter.
            </p>
          </div>
        ) : (
          <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-16 text-center">
            <p className="text-sm font-medium text-foreground">
              Nothing tagged yet
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
              As notes are understood, their recurring themes gather here. You
              can also tag one yourself.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setPickerOpen(true)}
            >
              <Plus />
              Add topic
            </Button>
          </div>
        )
      ) : (
        <>
          <ul className="flex flex-wrap items-baseline gap-x-2.5 gap-y-3">
            <AnimatePresence mode="popLayout">
              {all.map((entity) => (
                <TopicTag key={entity.id} entity={entity} total={totalNotes} />
              ))}
            </AnimatePresence>
          </ul>

          {filtering ? null : (
            <p className="mt-8 font-mono text-[0.6875rem] leading-relaxed tabular-nums text-subtle">
              {recurring} of {all.length} topic{all.length === 1 ? "" : "s"}{" "}
              appear in more than one note · {totalNotes} tag
              {totalNotes === 1 ? "" : "s"} in total
            </p>
          )}
        </>
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
