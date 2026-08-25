"use client";

import type {
  DuplicateSuspicion,
  Entity,
  TimeKind,
  UpdateEntityRequest,
} from "@lictory/contracts";
import { formatRecurrence } from "@lictory/contracts";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  MapPin,
  Merge,
  Pencil,
  Trash2,
  X,
} from "@/components/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { EntityChip } from "@/components/entities/entity-chip";
import { RecurrenceField } from "@/components/moments/recurrence-field";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/note-card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, fieldStyles } from "@/components/ui/input";
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

/** How precisely a place is pinned down, and where that position came from. */
const PLACE_PRECISION_LABEL: Record<string, string> = {
  exact: "Exact location",
  street: "Street level",
  locality: "Approximate — city level",
  region: "Approximate — region level",
  country: "Approximate — country level",
  unknown: "No location yet",
};

const PLACE_SOURCE_LABEL: Record<string, string> = {
  model: "read from your note",
  inherited: "borrowed from a nearby place you already had",
  geocoder: "looked up",
  user: "set by you",
};

/**
 * A pair the resolver could not separate confidently. Offered where the user is
 * already looking at the entity, because that is the moment they know the
 * answer. Merging is theirs to make; the system only ever proposes.
 */
function DuplicateBanner({
  suspicion,
  entityId,
  onResolved,
}: {
  suspicion: DuplicateSuspicion;
  entityId: string;
  onResolved: () => Promise<void>;
}) {
  const api = useApi();
  const [busy, setBusy] = React.useState<"merge" | "dismiss" | null>(null);
  const other =
    suspicion.candidate.id === entityId
      ? suspicion.entity
      : suspicion.candidate;

  const run = async (
    kind: "merge" | "dismiss",
    action: () => Promise<void>,
  ) => {
    setBusy(kind);
    try {
      await action();
      await onResolved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-dashed border-[rgb(var(--warning)/0.4)] bg-[rgb(var(--warning)/0.06)] p-4">
      <p className="text-sm font-medium text-foreground">
        This might be the same as “{other.name}”
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {suspicion.reason ?? "The names look alike."} Merging keeps this one and
        moves every note and spelling across.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={busy === "merge"}
          onClick={() =>
            void run("merge", async () => {
              await api.mergeEntities(entityId, other.id);
              toast.success(`Merged “${other.name}” in`);
            })
          }
        >
          <Merge />
          Merge them
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={busy === "dismiss"}
          onClick={() =>
            void run("dismiss", async () => {
              await api.dismissDuplicate(suspicion.id);
            })
          }
        >
          Not the same
        </Button>
      </div>
    </div>
  );
}

/**
 * The armed notification for a moment. A reminder the pipeline set up is
 * visibly the AI's doing and switchable off in one tap — and back on again,
 * because a one-way door is a bug.
 */
function ReminderPanel({
  entity,
  onChanged,
}: {
  entity: Entity;
  onChanged: () => Promise<void>;
}) {
  const api = useApi();
  const [busy, setBusy] = React.useState(false);
  const moment = entity.moment;
  if (!moment?.remindAt || !moment.triggerId) return null;

  const armed = moment.armed;
  const toggle = async () => {
    setBusy(true);
    try {
      await api.setTriggerStatus(
        moment.triggerId as string,
        armed ? "cancelled" : "active",
      );
      await onChanged();
      toast.success(armed ? "Reminder switched off" : "Reminder switched on");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface p-4">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md border",
          armed
            ? "border-[rgb(var(--ember)/0.35)] bg-[rgb(var(--ember)/0.12)] text-ember-bright"
            : "border-hairline text-subtle",
        )}
      >
        {armed ? (
          <BellRing className="size-4" />
        ) : (
          <BellOff className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-medium text-foreground">
          {armed ? "You'll be reminded" : "Reminder switched off"}
        </p>
        <p className="truncate text-xs text-subtle">
          {formatEntityTime(moment.remindAt, false)}
          {moment.reminderReason ? ` · ${moment.reminderReason}` : ""}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={() => void toggle()}
      >
        {armed ? "Turn off" : "Turn back on"}
      </Button>
    </div>
  );
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
        street: entity.place?.street ?? null,
        locality: entity.place?.locality ?? null,
        region: entity.place?.region ?? null,
        postalCode: entity.place?.postalCode ?? null,
        country: entity.place?.country ?? null,
        latitude: entity.latitude,
        longitude: entity.longitude,
        radiusMeters: entity.radiusMeters,
        startsAt: entity.startsAt,
        allDay: entity.allDay,
        recurrenceRule: entity.moment?.recurrence ?? null,
        timeKind: entity.timeKind,
        needsReminder: entity.needsReminder,
        reminderReason: entity.reminderReason,
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
  const duplicates = resource.data?.duplicates ?? [];

  // People and organisations are shown to each other explicitly, so an
  // organisation is reachable from the person who works there and vice versa.
  const isSocial = entity.type === "person" || entity.type === "organization";
  const counterpartType =
    entity.type === "person" ? "organization" : ("person" as const);
  const counterparts = isSocial
    ? related.filter((item: Entity) => item.type === counterpartType)
    : [];
  const otherRelated = isSocial
    ? related.filter((item: Entity) => item.type !== counterpartType)
    : related;

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
              {entity.moment?.recurrence ? (
                <>
                  <span>·</span>
                  <span>{formatRecurrence(entity.moment.recurrence)}</span>
                  {entity.moment.nextOccurrenceAt &&
                  entity.moment.nextOccurrenceAt !== entity.startsAt ? (
                    <>
                      <span>·</span>
                      <span>
                        next{" "}
                        {formatEntityTime(
                          entity.moment.nextOccurrenceAt,
                          entity.allDay,
                        )}
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
              {entity.type === "time" && entity.needsReminder ? (
                <>
                  <span>·</span>
                  <span className="text-ember-bright">Reminder suggested</span>
                </>
              ) : null}
              {entity.type === "place" && entity.place ? (
                <>
                  <span>·</span>
                  <span
                    className="inline-flex items-center gap-1"
                    title={`${PLACE_PRECISION_LABEL[entity.place.precision]} — ${PLACE_SOURCE_LABEL[entity.place.source]}`}
                  >
                    <MapPin className="size-3" />
                    {entity.place.latitude !== null
                      ? `${entity.place.latitude.toFixed(4)}, ${entity.place.longitude?.toFixed(4)}`
                      : PLACE_PRECISION_LABEL[entity.place.precision]}
                  </span>
                  {entity.place.source === "inherited" ? (
                    <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[0.625rem] text-subtle">
                      approximate
                    </span>
                  ) : null}
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
                <Field
                  label="Address"
                  hint="Saving re-reads the address and can fill in the coordinates."
                  className="sm:col-span-2"
                >
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
                <Field label="Street">
                  <Input
                    value={draft.street ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        street: event.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="City">
                  <Input
                    value={draft.locality ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        locality: event.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Region">
                  <Input
                    value={draft.region ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        region: event.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Postal code">
                  <Input
                    value={draft.postalCode ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        postalCode: event.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Country" className="sm:col-span-2">
                  <Input
                    value={draft.country ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        country: event.target.value || null,
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
              <>
                <Field label="When">
                  <Input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={
                      draft.allDay
                        ? (draft.startsAt ?? "").slice(0, 10)
                        : toLocalInput(draft.startsAt ?? null)
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        startsAt: !event.target.value
                          ? null
                          : current.allDay
                            ? event.target.value.slice(0, 10)
                            : new Date(event.target.value).toISOString(),
                      }))
                    }
                  />
                </Field>
                <label className="flex items-center gap-2.5 rounded-md border border-hairline bg-canvas-raised px-3.5 py-2.5 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={draft.allDay ?? false}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        allDay: event.target.checked,
                        // Switching to all-day drops the clock time rather than
                        // silently keeping a midnight nobody chose.
                        startsAt: current.startsAt
                          ? event.target.checked
                            ? current.startsAt.slice(0, 10)
                            : current.startsAt
                          : current.startsAt,
                      }))
                    }
                    className="accent-ember"
                  />
                  All day
                </label>
                <Field label="Kind">
                  <select
                    value={draft.timeKind ?? "date"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        timeKind: event.target.value as TimeKind,
                      }))
                    }
                    className={cn(fieldStyles, "h-10")}
                  >
                    <option value="date">Date</option>
                    <option value="event">Event</option>
                    <option value="deadline">Deadline</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <RecurrenceField
                    value={draft.recurrenceRule ?? null}
                    onChange={(next) =>
                      setDraft((current) => ({
                        ...current,
                        recurrenceRule: next,
                      }))
                    }
                  />
                </div>
                <label className="flex items-center gap-2.5 rounded-md border border-hairline bg-canvas-raised px-3.5 py-2.5 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={draft.needsReminder ?? false}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        needsReminder: event.target.checked,
                      }))
                    }
                    className="accent-ember"
                  />
                  Needs a reminder
                </label>
                {draft.needsReminder ? (
                  <Field label="Reminder reason" className="sm:col-span-2">
                    <Input
                      value={draft.reminderReason ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          reminderReason: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ) : null}
              </>
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

      {duplicates.map((suspicion: DuplicateSuspicion) => (
        <DuplicateBanner
          key={suspicion.id}
          suspicion={suspicion}
          entityId={entity.id}
          onResolved={async () => {
            await resource.refresh();
          }}
        />
      ))}

      {entity.type === "time" ? (
        <ReminderPanel
          entity={entity}
          onChanged={async () => {
            await resource.refresh();
          }}
        />
      ) : null}

      {counterparts.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-semibold tracking-tight">
            {ENTITY_META[counterpartType].plural}
          </h2>
          <div className="flex flex-wrap gap-2">
            {counterparts.map((item: Entity) => (
              <EntityChip key={item.id} entity={item} />
            ))}
          </div>
        </section>
      ) : null}

      {otherRelated.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2.5 text-sm font-semibold tracking-tight">
            Usually appears with
          </h2>
          <div className="flex flex-wrap gap-2">
            {otherRelated.map((item: Entity) => (
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
