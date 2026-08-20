import type { EntityType, NoteStatus } from "@lictory/contracts";
import {
  Building2,
  CalendarClock,
  Hash,
  MapPin,
  UserRound,
  type IconComponent,
} from "@/components/ui/icons";

export type EntityTypeMeta = {
  label: string;
  plural: string;
  icon: IconComponent;
  /** Tailwind classes for the chip surface. */
  chip: string;
  /** Tailwind classes for a solid dot / icon tint. */
  tint: string;
  listHref: string;
};

export const ENTITY_META: Record<EntityType, EntityTypeMeta> = {
  person: {
    label: "Person",
    plural: "People",
    icon: UserRound,
    chip: "border-[rgb(var(--entity-person)/0.35)] bg-[rgb(var(--entity-person)/0.12)] text-[rgb(var(--entity-person))] hover:bg-[rgb(var(--entity-person)/0.2)]",
    tint: "text-[rgb(var(--entity-person))]",
    listHref: "/app/people",
  },
  place: {
    label: "Place",
    plural: "Places",
    icon: MapPin,
    chip: "border-[rgb(var(--entity-place)/0.35)] bg-[rgb(var(--entity-place)/0.12)] text-[rgb(var(--entity-place))] hover:bg-[rgb(var(--entity-place)/0.2)]",
    tint: "text-[rgb(var(--entity-place))]",
    listHref: "/app/places",
  },
  time: {
    label: "Moment",
    plural: "Moments",
    icon: CalendarClock,
    chip: "border-[rgb(var(--entity-time)/0.35)] bg-[rgb(var(--entity-time)/0.12)] text-[rgb(var(--entity-time))] hover:bg-[rgb(var(--entity-time)/0.2)]",
    tint: "text-[rgb(var(--entity-time))]",
    listHref: "/app/calendar",
  },
  topic: {
    label: "Topic",
    plural: "Topics",
    icon: Hash,
    chip: "border-[rgb(var(--entity-topic)/0.35)] bg-[rgb(var(--entity-topic)/0.12)] text-[rgb(var(--entity-topic))] hover:bg-[rgb(var(--entity-topic)/0.2)]",
    tint: "text-[rgb(var(--entity-topic))]",
    listHref: "/app/topics",
  },
  organization: {
    label: "Organisation",
    plural: "Organisations",
    icon: Building2,
    chip: "border-[rgb(var(--entity-organization)/0.35)] bg-[rgb(var(--entity-organization)/0.12)] text-[rgb(var(--entity-organization))] hover:bg-[rgb(var(--entity-organization)/0.2)]",
    tint: "text-[rgb(var(--entity-organization))]",
    listHref: "/app/people",
  },
};

export const ROLE_LABEL: Record<string, string> = {
  mentions: "Mentioned",
  about: "About",
  happens_at: "Happens at",
  located_at: "Located at",
  with_person: "With",
};

export const NOTE_STATUS_META: Record<
  NoteStatus,
  { label: string; orb: "idle" | "queued" | "thinking" | "ready" | "failed" }
> = {
  draft: { label: "Draft", orb: "idle" },
  queued: { label: "Finishing up", orb: "queued" },
  processing: { label: "Finishing up", orb: "thinking" },
  ready: { label: "Ready", orb: "ready" },
  failed: { label: "Needs attention", orb: "failed" },
};

export function entityHref(entityId: string): string {
  return `/app/context/${entityId}`;
}

/** Human label for a time entity, tolerant of missing or partial values. */
export function formatEntityTime(
  startsAt: string | null,
  allDay: boolean,
): string | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }),
  });
}

export function relativeTime(iso: string): string {
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) return "";
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: days > 300 ? "numeric" : undefined,
  });
}
