"use client";

import type { Entity, NoteSummary } from "@lictory/contracts";
import { Command } from "cmdk";
import { Search, Sparkles, StickyNote } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

import { useApi } from "@/lib/api";
import { ENTITY_META, entityHref } from "@/lib/entities";
import { cn } from "@/lib/utils";

/**
 * ⌘K search spans both halves of the model: the notes themselves and the
 * entities extracted from them.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const api = useApi();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [notes, setNotes] = React.useState<NoteSummary[]>([]);
  const [entities, setEntities] = React.useState<Entity[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [session, setSession] = React.useState(open);
  if (session !== open) {
    setSession(open);
    setQuery("");
    setNotes([]);
    setEntities([]);
  }

  const tooShort = !open || query.trim().length < 2;
  const results = tooShort ? { notes: [], entities: [] } : { notes, entities };

  // cmdk keeps whatever was highlighted before results arrive, which would
  // leave the trailing "capture" action selected. Pin selection to the first
  // real result each time the result set changes.
  const firstValue =
    results.entities[0] !== undefined
      ? `entity-${results.entities[0].id}`
      : results.notes[0] !== undefined
        ? `note-${results.notes[0].id}`
        : "new-note";
  const [selected, setSelected] = React.useState(firstValue);
  const [selectionKey, setSelectionKey] = React.useState(firstValue);
  if (selectionKey !== firstValue) {
    setSelectionKey(firstValue);
    setSelected(firstValue);
  }

  React.useEffect(() => {
    if (tooShort) return;
    const handle = setTimeout(() => {
      setLoading(true);
      void api
        .search(query.trim())
        .then((result) => {
          setNotes(result.notes);
          setEntities(result.entities);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [api, tooShort, query]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden",
            "rounded-md border border-hairline-strong bg-canvas-raised",
            "shadow-[0_40px_120px_-30px_rgb(0_0_0/0.95)]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <VisuallyHidden>
            <DialogPrimitive.Title>Search Lictory</DialogPrimitive.Title>
          </VisuallyHidden>

          <Command
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
            className="flex flex-col"
          >
            <div className="flex items-center gap-3 border-b border-hairline px-4">
              <Search className="size-4 shrink-0 text-subtle" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search notes, people, places, moments…"
                className="h-14 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
              />
              {loading ? (
                <span className="size-3 animate-spin rounded-full border border-ember border-t-transparent" />
              ) : null}
            </div>

            <Command.List className="max-h-[55vh] overflow-y-auto p-2">
              {query.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-xs text-subtle">
                  Type at least two characters to search everything you have
                  captured.
                </p>
              ) : null}

              {query.trim().length >= 2 &&
              !loading &&
              results.notes.length === 0 &&
              results.entities.length === 0 ? (
                <Command.Empty className="px-3 py-6 text-center text-xs text-subtle">
                  Nothing matches “{query}”.
                </Command.Empty>
              ) : null}

              {results.entities.length > 0 ? (
                <Command.Group
                  heading="Context"
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.625rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-subtle"
                >
                  {results.entities.map((entity) => {
                    const meta = ENTITY_META[entity.type];
                    const Icon = meta.icon;
                    return (
                      <Command.Item
                        key={entity.id}
                        value={`entity-${entity.id}`}
                        onSelect={() => go(entityHref(entity.id))}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors data-[selected=true]:bg-surface-strong data-[selected=true]:text-foreground"
                      >
                        <Icon className={cn("size-3.5 shrink-0", meta.tint)} />
                        <span className="flex-1 truncate">{entity.name}</span>
                        <span className="text-[0.6875rem] text-subtle">
                          {meta.label}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}

              {results.notes.length > 0 ? (
                <Command.Group
                  heading="Notes"
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.625rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-subtle"
                >
                  {results.notes.map((note) => (
                    <Command.Item
                      key={note.id}
                      value={`note-${note.id}`}
                      onSelect={() => go(`/app/notes/${note.id}`)}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors data-[selected=true]:bg-surface-strong data-[selected=true]:text-foreground"
                    >
                      <StickyNote className="mt-0.5 size-3.5 shrink-0 text-subtle" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {note.title ?? "Untitled note"}
                        </span>
                        <span className="block truncate text-[0.6875rem] text-subtle">
                          {note.aiSummary ?? note.excerpt}
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group className="mt-1 border-t border-hairline pt-1">
                <Command.Item
                  value="new-note"
                  onSelect={() => go("/app")}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors data-[selected=true]:bg-surface-strong data-[selected=true]:text-foreground"
                >
                  <Sparkles className="size-3.5 shrink-0 text-ember" />
                  Capture something new
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
