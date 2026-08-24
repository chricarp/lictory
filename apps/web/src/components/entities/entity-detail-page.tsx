"use client";

import type { Entity, UpdateEntityRequest } from "@lictory/contracts";
import {
  ArrowLeft,
  Check,
  MapPin,
  Pencil,
  Trash2,
  X,
} from "@/components/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { EntityChip } from "@/components/entities/entity-chip";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/note-card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";
import { ENTITY_META, formatEntityTime } from "@/lib/entities";
import { cn } from "@/lib/utils";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function EntityDetailPage({ entityId }: { entityId: string }) {
  const api = useApi();
  const router = useRouter();
  const resource = useResource(`entity:${entityId}`, () =>
    api.getEntity(entityId),
  );
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const entity = resource.data?.entity;

  // The edit form is seeded from the loaded entity during render, so a refresh
  // that lands mid-edit does not silently discard what is being typed.
  const [form, setForm] = React.useState<{
    id: string | null;
    draft: UpdateEntityRequest;
  }>({ id: null, draft: {} });
  if (entity && form.id !== entity.id) {
    setForm({
      id: entity.id,
      draft: {
        name: entity.name,
        description: entity.description,
        address: entity.address,
        latitude: entity.latitude,
        longitude: entity.longitude,
        radiusMeters: entity.radiusMeters,
        startsAt: entity.startsAt,
        allDay: entity.allDay,
      },
    });
  }
  const draft = form.draft;
  const setDraft = React.useCallback(
    (next: (current: UpdateEntityRequest) => UpdateEntityRequest) =>
      setForm((current) => ({ ...current, draft: next(current.draft) })),
    [],
  );

  if (resource.initialLoading) {
    return (
      <div className="w-full max-w-4xl">
        <Skeleton className="mb-4 h-8 w-24" />
        <Skeleton className="mb-6 h-24 w-full rounded-md" />
        <div className="grid gap-3 sm:grid-cols-2">
          <NoteCardSkeleton />
          <NoteCardSkeleton />
        </div>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="w-full max-w-4xl">
        <p className="rounded-md border border-hairline bg-surface p-6 text-sm text-muted">
          {resource.error?.message ?? "This context no longer exists."}
        </p>
      </div>
    );
  }

  const meta = ENTITY_META[entity.type];
  const Icon = meta.icon;
  const notes = resource.data?.notes ?? [];
  const related = resource.data?.related ?? [];

  const save = async () => {
    setSaving(true);
    try {
      await api.updateEntity(entity.id, draft);
      await resource.refresh();
      setEditing(false);
      toast.success("Context updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-4xl">
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href={meta.listHref}>
          <ArrowLeft />
          {meta.plural}
        </Link>
      </Button>

      <header className="mb-6 border-b border-hairline pb-6">
        <div className="flex items-start gap-4">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-md border",
              meta.chip,
            )}
          >
            <Icon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={draft.name ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mb-2 h-10 border-0 bg-transparent px-0 text-xl font-semibold tracking-tight focus:bg-transparent"
              />
            ) : (
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {entity.name}
              </h1>
            )}

            <p className="flex flex-wrap items-center gap-2 text-xs text-subtle">
              <span>{meta.label}</span>
              <span>·</span>
              <span className="tabular-nums">
                {notes.length} note{notes.length === 1 ? "" : "s"}
              </span>
              {entity.type === "time" && entity.startsAt ? (
                <>
                  <span>·</span>
                  <span>
                    {formatEntityTime(entity.startsAt, entity.allDay)}
                  </span>
                </>
              ) : null}
              {entity.type === "place" && entity.latitude !== null ? (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {entity.latitude.toFixed(4)}, {entity.longitude?.toFixed(4)}
                  </span>
                </>
              ) : null}
            </p>

            {!editing && entity.description ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {entity.description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={editing ? "Cancel editing" : "Edit context"}
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? <X /> : <Pencil />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete context"
              className="hover:text-danger"
              onClick={async () => {
                await api.deleteEntity(entity.id);
                toast.success(`${entity.name} removed`);
                router.push(meta.listHref);
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                value={draft.description ?? ""}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="min-h-16"
              />
            </Field>

            {entity.type === "place" ? (
              <>
                <Field label="Address" className="sm:col-span-2">
                  <Input
                    value={draft.address ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        address: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Latitude">
                  <Input
                    inputMode="decimal"
                    value={draft.latitude ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        latitude: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }))
                    }
                  />
                </Field>
                <Field label="Longitude">
                  <Input
                    inputMode="decimal"
                    value={draft.longitude ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        longitude: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Radius (m)"
                  hint="Notes here can resurface when you arrive."
                  className="sm:col-span-2"
                >
                  <Input
                    inputMode="numeric"
                    value={draft.radiusMeters ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        radiusMeters: event.target.value
                          ? Number(event.target.value)
                          : null,
                      }))
                    }
                  />
                </Field>
              </>
            ) : null}

            {entity.type === "time" ? (
              <Field label="When" className="sm:col-span-2">
                <Input
                  type="datetime-local"
                  value={toLocalInput(draft.startsAt ?? null)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      startsAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    }))
                  }
                />
              </Field>
            ) : null}

            <div className="flex items-center gap-2 sm:col-span-2">
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                onClick={() => void save()}
              >
                <Check />
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </header>

      {related.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-semibold tracking-tight">
            Usually appears with
          </h2>
          <div className="flex flex-wrap gap-2">
            {related.map((item: Entity) => (
              <EntityChip key={item.id} entity={item} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">
          Notes about {entity.name}
        </h2>
        {notes.length === 0 ? (
          <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-12 text-center text-xs text-subtle">
            No notes are linked to this yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
