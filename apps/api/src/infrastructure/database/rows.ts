/** Raw D1 row shapes. Public API shapes are defined in @lictory/contracts. */
export type MediaRow = {
  id: string;
  user_id: string;
  note_id: string | null;
  kind: "image" | "audio" | "document";
  original_name: string;
  object_key: string;
  content_type: string;
  byte_size: number;
  duration_seconds: number | null;
  position: number;
  status:
    | "pending_upload"
    | "uploaded"
    | "queued"
    | "processing"
    | "completed"
    | "failed";
  upload_token: string | null;
  ai_result: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type NoteRow = {
  id: string;
  user_id: string;
  title: string | null;
  body_markdown: string;
  status: "draft" | "queued" | "processing" | "ready" | "failed";
  ai_summary: string | null;
  ai_error: string | null;
  occurred_at: string | null;
  pinned: number;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EntityRow = {
  id: string;
  user_id: string;
  type: "person" | "place" | "time" | "topic" | "organization";
  name: string;
  normalized_key: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  address: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: number;
  timezone: string | null;
  recurrence: string | null;
  color: string | null;
  origin: "ai" | "user";
  created_at: string;
  updated_at: string;
  note_count?: number;
};

export type NoteEntityRow = {
  note_id: string;
  entity_id: string;
  role: "mentions" | "about" | "happens_at" | "located_at" | "with_person";
  confidence: number;
  origin: "ai" | "user";
  status: "suggested" | "confirmed" | "rejected";
  mention: string | null;
  created_at: string;
};

export type NoteLinkRow = {
  id: string;
  user_id: string;
  source_note_id: string;
  target_note_id: string;
  relation: "related" | "follow_up" | "duplicate" | "references";
  confidence: number;
  origin: "ai" | "user";
  status: "suggested" | "confirmed" | "rejected";
  reason: string | null;
  created_at: string;
};

export type ProcessingStepRow = {
  id: string;
  note_id: string;
  stage: "transcribe" | "describe" | "extract" | "resolve" | "connect";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type TriggerRow = {
  id: string;
  user_id: string;
  type: "time" | "location";
  status: "active" | "triggered" | "cancelled";
  title: string;
  body: string;
  scheduled_for: string | null;
  timezone: string | null;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  location_event: "enter" | "exit" | null;
  note_id: string | null;
  entity_id: string | null;
  created_at: string;
  triggered_at: string | null;
};
