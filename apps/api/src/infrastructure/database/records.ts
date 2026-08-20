import type {
  Attachment,
  Entity,
  MediaAsset,
  NoteEntity,
  NoteLink,
  ProcessingStep,
  Trigger,
} from "@lictory/contracts";

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
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  allDay: row.all_day === 1,
  timezone: row.timezone,
  recurrence: row.recurrence,
  color: row.color,
  origin: row.origin,
  ...(row.note_count === undefined ? {} : { noteCount: row.note_count }),
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
