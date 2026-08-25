import type {
  Attachment,
  Entity,
  MediaAsset,
  NoteEntity,
  NoteLink,
  ProcessingStep,
  Trigger,
} from "@lictory/contracts";

import { momentRecord } from "../../features/entities/moments";
import { placeRecord } from "../../features/entities/places";
import type {
  EntityRow,
  MediaRow,
  NoteEntityRow,
  NoteLinkRow,
  ProcessingStepRow,
  TriggerRow,
} from "./rows";

export const mediaRecord = (row: MediaRow): MediaAsset => ({
  id: row.id,
  kind: row.kind,
  fileName: row.original_name,
  contentType: row.content_type,
  bytes: row.byte_size,
  status: row.status,
  aiResult: row.ai_result,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const attachmentRecord = (
  row: MediaRow,
  url: string | null = null,
): Attachment => ({
  id: row.id,
  noteId: row.note_id,
  kind: row.kind,
  fileName: row.original_name,
  contentType: row.content_type,
  bytes: row.byte_size,
  status: row.status,
  aiResult: row.ai_result,
  failureReason: row.failure_reason,
  durationSeconds: row.duration_seconds,
  position: row.position,
  url,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const entityRecord = (row: EntityRow): Entity => ({
  id: row.id,
  type: row.type,
  name: row.name,
  normalizedKey: row.normalized_key,
  description: row.description,
  latitude: row.latitude,
  longitude: row.longitude,
  radiusMeters: row.radius_meters,
  address: row.address,
  // The moment facet is authoritative for timing; the columns on `entities`
  // are the mirror it writes for clients that still read the flat shape.
  startsAt: row.moment?.starts_at ?? row.starts_at,
  endsAt: row.moment?.ends_at ?? row.ends_at,
  allDay: (row.moment?.all_day ?? row.all_day) === 1,
  timezone: row.moment?.timezone ?? row.timezone,
  recurrence: row.moment?.recurrence_text ?? row.recurrence,
  timeKind: row.moment?.kind ?? row.time_kind,
  needsReminder: (row.moment?.needs_reminder ?? row.needs_reminder) === 1,
  reminderReason: row.moment?.reminder_reason ?? row.reminder_reason,
  color: row.color,
  origin: row.origin,
  ...(row.note_count === undefined ? {} : { noteCount: row.note_count }),
  // Facets are attached only by queries that hydrate them, so a list endpoint
  // stays one round trip while a detail view gets the full structure.
  place: row.place ? placeRecord(row.place) : null,
  moment: row.moment ? momentRecord(row.moment) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const noteEntityRecord = (
  edge: NoteEntityRow,
  entity: EntityRow,
): NoteEntity => ({
  entity: entityRecord(entity),
  role: edge.role,
  confidence: edge.confidence,
  origin: edge.origin,
  status: edge.status,
  mention: edge.mention,
  createdAt: edge.created_at,
});

export const processingStepRecord = (
  row: ProcessingStepRow,
): ProcessingStep => ({
  id: row.id,
  stage: row.stage,
  status: row.status,
  detail: row.detail,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export const noteLinkRecord = (
  row: NoteLinkRow,
  direction: "outgoing" | "incoming",
  note: {
    id: string;
    title: string | null;
    excerpt: string;
    createdAt: string;
  },
): NoteLink => ({
  id: row.id,
  relation: row.relation,
  direction,
  confidence: row.confidence,
  origin: row.origin,
  status: row.status,
  reason: row.reason,
  note,
  createdAt: row.created_at,
});

export const triggerRecord = (row: TriggerRow): Trigger => ({
  id: row.id,
  type: row.type,
  status: row.status,
  title: row.title,
  body: row.body,
  scheduledFor: row.scheduled_for,
  timezone: row.timezone,
  label: row.location_label,
  latitude: row.latitude,
  longitude: row.longitude,
  radiusMeters: row.radius_meters,
  event: row.location_event,
  origin: row.origin,
  noteId: row.note_id,
  entityId: row.entity_id,
  createdAt: row.created_at,
  triggeredAt: row.triggered_at,
});

/** Plain-text preview of a Markdown body for list rendering. */
export function excerptFrom(markdown: string, fallback = ""): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const source = text || fallback.replace(/\s+/g, " ").trim();
  return source.length > 240 ? `${source.slice(0, 239)}…` : source;
}
