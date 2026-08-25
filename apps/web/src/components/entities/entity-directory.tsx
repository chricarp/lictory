"use client";

import type { Entity, EntityType } from "@lictory/contracts";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Search, X } from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import { EntityPicker } from "@/components/entities/entity-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";
import { ENTITY_META, entityHref, formatEntityTime } from "@/lib/entities";
import { cn } from "@/lib/utils";

function EntityRow({ entity }: { entity: Entity }) {
  const meta = ENTITY_META[entity.type];
  const Icon = meta.icon;
  const count = entity.noteCount ?? 0;
  const detail =
    entity.type === "time"
      ? formatEntityTime(entity.startsAt, entity.allDay)
      : entity.type === "place"
        ? entity.address
        : entity.description;

  return (
    <motion.div
      layout
      // A grid item defaults to `min-width: auto`, so the `nowrap` that
      // `truncate` sets on the name below propagates all the way out and sizes
      // the column to the untruncated text. This is what lets it shrink.
      className="min-w-0"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <Link
        href={entityHref(entity.id)}
        className="group flex items-center gap-3 rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong hover:bg-surface-strong"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border",
            meta.chip,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-medium text-foreground">
            {entity.name}
          </p>
          <p className="truncate text-xs text-subtle">
            {detail ?? `${count} note${count === 1 ? "" : "s"}`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-strong px-2 py-1 text-[0.6875rem] tabular-nums text-subtle">
          {count}
        </span>
      </Link>
    </motion.div>
  );
}

export function EntityDirectory({
  type,
  title,
  description,
  /**
   * Extra kinds shown alongside the primary one. People and Organisations live
   * together because that is how they are actually recalled — you look for the
   * company to find the person, and the person to remember the company.
   */
  alsoInclude = [],
}: {
  type: EntityType;
  title: string;
  description: string;
  alsoInclude?: EntityType[];
}) {
  const api = useApi();
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<EntityType | "all">("all");

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  const types = React.useMemo(
    () => [type, ...alsoInclude],
    [type, alsoInclude],
  );
  const key = types.join(",");

  const entities = useResource(`entities:${key}:${debounced}`, () =>
    api.listEntities({ types, q: debounced || undefined }),
  );

  const all = React.useMemo(
    () => entities.data?.entities ?? [],
    [entities.data],
  );
  const results = React.useMemo(
    () => (filter === "all" ? all : all.filter((e) => e.type === filter)),
    [all, filter],
  );
  const meta = ENTITY_META[type];

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6">
        <div className="mb-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.035em]">
            {title}
          </h1>
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
            Add {meta.label.toLowerCase()}
          </Button>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {description}
        </p>
      </header>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
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

      {types.length > 1 ? (
        <div
          role="tablist"
          aria-label={`Filter ${title.toLowerCase()}`}
          className="mb-5 flex flex-wrap gap-1.5"
        >
          {(["all", ...types] as const).map((value) => {
            const active = filter === value;
            const label =
              value === "all" ? "All" : ENTITY_META[value as EntityType].plural;
            const count =
              value === "all"
                ? all.length
                : all.filter((e) => e.type === value).length;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(value as EntityType | "all")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]",
                  active
                    ? value === "all"
                      ? "border-hairline-strong bg-surface-strong text-foreground"
                      : ENTITY_META[value as EntityType].chip
                    : "border-hairline text-subtle hover:border-hairline-strong hover:text-foreground",
                )}
              >
                {label}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {entities.initialLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-[4.5rem] rounded-lg" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            Nothing here yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
            {meta.plural} will gather here as you add notes. You can also add
            one yourself.
          </p>
        </div>
      ) : (
        <motion.div layout className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {results.map((entity) => (
              <EntityRow key={entity.id} entity={entity} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialType={type}
        onSubmit={async (input) => {
          if (input.entity) await api.createEntity(input.entity);
          await entities.refresh();
        }}
      />
    </div>
  );
}
