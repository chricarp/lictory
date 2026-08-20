"use client";

import type {
  Entity,
  EntityInput,
  EntityRole,
  EntityType,
} from "@lictory/contracts";
import { Check, Plus, Search } from "@/components/ui/icons";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useApi } from "@/lib/api";
import { ENTITY_META } from "@/lib/entities";
import { cn } from "@/lib/utils";

const TYPES: EntityType[] = [
  "person",
  "place",
  "time",
  "topic",
  "organization",
];

const DEFAULT_ROLE: Record<EntityType, EntityRole> = {
  person: "with_person",
  place: "located_at",
  time: "happens_at",
  topic: "about",
  organization: "mentions",
};

export type EntityPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Attach the chosen entity to this note; omit to only create the entity. */
  onSubmit: (input: {
    entityId?: string;
    entity?: EntityInput;
    role: EntityRole;
  }) => Promise<void>;
  initialType?: EntityType;
};

/**
 * The manual counterpart to AI extraction: everything the model can infer, a
 * person can also add, correct or remove by hand.
 */
export function EntityPicker({
  open,
  onOpenChange,
  onSubmit,
  initialType = "person",
}: EntityPickerProps) {
  const api = useApi();
  const [type, setType] = React.useState<EntityType>(initialType);
  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<Entity[]>([]);
  const [saving, setSaving] = React.useState(false);

  const [address, setAddress] = React.useState("");
  const [latitude, setLatitude] = React.useState("");
  const [longitude, setLongitude] = React.useState("");
  const [radius, setRadius] = React.useState("250");
  const [startsAt, setStartsAt] = React.useState("");

  // Reset during render on each open so the dialog never flashes the previous
  // search before the effect clears it.
  const [session, setSession] = React.useState(open);
  if (session !== open) {
    setSession(open);
    if (open) {
      setType(initialType);
      setQuery("");
      setMatches([]);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void api
        .listEntities({ type, q: query || undefined })
        .then((result) => setMatches(result.entities.slice(0, 6)))
        .catch(() => setMatches([]));
    }, 220);
    return () => clearTimeout(handle);
  }, [api, open, type, query]);

  const exactMatch = matches.find(
    (entity) => entity.name.toLowerCase() === query.trim().toLowerCase(),
  );

  const attach = async (payload: {
    entityId?: string;
    entity?: EntityInput;
  }) => {
    setSaving(true);
    try {
      await onSubmit({ ...payload, role: DEFAULT_ROLE[type] });
      onOpenChange(false);
      setQuery("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add that context",
      );
    } finally {
      setSaving(false);
    }
  };

  const createNew = () => {
    const name = query.trim();
    if (!name) return;
    const entity: EntityInput = { type, name };
    if (type === "place") {
      if (address.trim()) entity.address = address.trim();
      if (latitude && longitude) {
        entity.latitude = Number(latitude);
        entity.longitude = Number(longitude);
        entity.radiusMeters = Number(radius) || 250;
      }
    }
    if (type === "time" && startsAt) {
      entity.startsAt = new Date(startsAt).toISOString();
      entity.allDay = startsAt.length <= 10;
    }
    void attach({ entity });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add context</DialogTitle>
          <DialogDescription>
            Link this note to a person, place, moment or topic.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((item) => {
              const meta = ENTITY_META[item];
              const Icon = meta.icon;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setType(item)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                    type === item
                      ? meta.chip
                      : "border-hairline text-subtle hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <Field label="Name">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && query.trim()) {
                    event.preventDefault();
                    if (exactMatch) void attach({ entityId: exactMatch.id });
                    else createNew();
                  }
                }}
                placeholder={
                  type === "time"
                    ? "e.g. Dentist appointment"
                    : type === "place"
                      ? "e.g. Bar Luce, Milan"
                      : "Search or create…"
                }
                className="pl-9"
              />
            </div>
          </Field>

          {type === "place" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Address" className="col-span-2">
                <Input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Optional"
                />
              </Field>
              <Field label="Latitude">
                <Input
                  value={latitude}
                  onChange={(event) => setLatitude(event.target.value)}
                  inputMode="decimal"
                  placeholder="45.4642"
                />
              </Field>
              <Field label="Longitude">
                <Input
                  value={longitude}
                  onChange={(event) => setLongitude(event.target.value)}
                  inputMode="decimal"
                  placeholder="9.1900"
                />
              </Field>
              <Field
                label="Radius (m)"
                hint="How close you need to be for this note to resurface."
                className="col-span-2"
              >
                <Input
                  value={radius}
                  onChange={(event) => setRadius(event.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>
          ) : null}

          {type === "time" ? (
            <Field label="When" hint="Leave empty for an undated moment.">
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </Field>
          ) : null}

          {matches.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-subtle">
                Already in your context
              </p>
              {matches.map((entity) => {
                const Icon = ENTITY_META[entity.type].icon;
                return (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => void attach({ entityId: entity.id })}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-strong hover:text-foreground"
                  >
                    <Icon
                      className={cn("size-3.5", ENTITY_META[entity.type].tint)}
                    />
                    <span className="flex-1 truncate">{entity.name}</span>
                    {entity.noteCount ? (
                      <span className="text-xs tabular-nums text-subtle">
                        {entity.noteCount} notes
                      </span>
                    ) : null}
                    <Check className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!query.trim()}
            onClick={() =>
              exactMatch
                ? void attach({ entityId: exactMatch.id })
                : createNew()
            }
          >
            <Plus />
            {exactMatch ? `Link ${exactMatch.name}` : "Create & link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
