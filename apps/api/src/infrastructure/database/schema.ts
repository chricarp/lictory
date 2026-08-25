import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
};

export const users = sqliteTable("user", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey().notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: integer("accessTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("account_provider_account_idx").on(
      table.providerId,
      table.accountId,
    ),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey().notNull(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const passkeys = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name"),
    publicKey: text("publicKey").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credentialID").notNull().unique(),
    counter: integer("counter").notNull(),
    deviceType: text("deviceType").notNull(),
    backedUp: integer("backedUp", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (table) => [index("passkey_userId_idx").on(table.userId)],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    title: text("title"),
    body_markdown: text("body_markdown").notNull().default(""),
    status: text("status", {
      enum: ["draft", "queued", "processing", "ready", "failed"],
    })
      .notNull()
      .default("draft"),
    ai_summary: text("ai_summary"),
    ai_error: text("ai_error"),
    occurred_at: text("occurred_at"),
    pinned: integer("pinned").notNull().default(0),
    processed_at: text("processed_at"),
    ...timestamps,
  },
  (table) => [
    index("notes_user_created_idx").on(table.user_id, table.created_at),
    index("notes_user_status_idx").on(table.user_id, table.status),
    check(
      "notes_status_check",
      sql`${table.status} in ('draft', 'queued', 'processing', 'ready', 'failed')`,
    ),
  ],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    note_id: text("note_id").references(() => notes.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: ["image", "audio", "document"] }).notNull(),
    original_name: text("original_name").notNull(),
    object_key: text("object_key").notNull().unique(),
    content_type: text("content_type").notNull(),
    byte_size: integer("byte_size").notNull(),
    duration_seconds: real("duration_seconds"),
    position: integer("position").notNull().default(0),
    status: text("status", {
      enum: [
        "pending_upload",
        "uploaded",
        "queued",
        "processing",
        "completed",
        "failed",
      ],
    }).notNull(),
    upload_token: text("upload_token"),
    ai_result: text("ai_result"),
    failure_reason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    index("media_assets_user_created_idx").on(table.user_id, table.created_at),
    index("media_assets_note_idx").on(table.note_id, table.position),
    check(
      "media_assets_kind_check",
      sql`${table.kind} in ('image', 'audio', 'document')`,
    ),
    check(
      "media_assets_status_check",
      sql`${table.status} in ('pending_upload', 'uploaded', 'queued', 'processing', 'completed', 'failed')`,
    ),
  ],
);

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    type: text("type", {
      enum: ["person", "place", "time", "topic", "organization"],
    }).notNull(),
    name: text("name").notNull(),
    normalized_key: text("normalized_key").notNull(),
    description: text("description"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    radius_meters: integer("radius_meters"),
    address: text("address"),
    starts_at: text("starts_at"),
    ends_at: text("ends_at"),
    all_day: integer("all_day").notNull().default(0),
    timezone: text("timezone"),
    recurrence: text("recurrence"),
    color: text("color"),
    origin: text("origin", { enum: ["ai", "user"] })
      .notNull()
      .default("ai"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("entities_identity_idx").on(
      table.user_id,
      table.type,
      table.normalized_key,
    ),
    index("entities_user_type_idx").on(table.user_id, table.type, table.name),
    index("entities_time_idx").on(table.user_id, table.starts_at),
    check(
      "entities_type_check",
      sql`${table.type} in ('person', 'place', 'time', 'topic', 'organization')`,
    ),
    check("entities_origin_check", sql`${table.origin} in ('ai', 'user')`),
  ],
);

export const noteEntities = sqliteTable(
  "note_entities",
  {
    note_id: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    entity_id: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    role: text("role", {
      enum: ["mentions", "about", "happens_at", "located_at", "with_person"],
    })
      .notNull()
      .default("mentions"),
    confidence: real("confidence").notNull().default(1),
    origin: text("origin", { enum: ["ai", "user"] })
      .notNull()
      .default("ai"),
    status: text("status", {
      enum: ["suggested", "confirmed", "rejected"],
    })
      .notNull()
      .default("suggested"),
    mention: text("mention"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.note_id, table.entity_id, table.role] }),
    index("note_entities_entity_idx").on(table.entity_id, table.status),
    index("note_entities_note_idx").on(table.note_id, table.status),
    check(
      "note_entities_role_check",
      sql`${table.role} in ('mentions', 'about', 'happens_at', 'located_at', 'with_person')`,
    ),
    check("note_entities_origin_check", sql`${table.origin} in ('ai', 'user')`),
    check(
      "note_entities_status_check",
      sql`${table.status} in ('suggested', 'confirmed', 'rejected')`,
    ),
  ],
);

export const noteLinks = sqliteTable(
  "note_links",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    source_note_id: text("source_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    target_note_id: text("target_note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    relation: text("relation", {
      enum: ["related", "follow_up", "duplicate", "references"],
    })
      .notNull()
      .default("related"),
    confidence: real("confidence").notNull().default(1),
    origin: text("origin", { enum: ["ai", "user"] })
      .notNull()
      .default("ai"),
    status: text("status", {
      enum: ["suggested", "confirmed", "rejected"],
    })
      .notNull()
      .default("suggested"),
    reason: text("reason"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("note_links_pair_idx").on(
      table.source_note_id,
      table.target_note_id,
      table.relation,
    ),
    index("note_links_target_idx").on(table.target_note_id),
    index("note_links_user_idx").on(table.user_id, table.created_at),
    check(
      "note_links_relation_check",
      sql`${table.relation} in ('related', 'follow_up', 'duplicate', 'references')`,
    ),
    check("note_links_origin_check", sql`${table.origin} in ('ai', 'user')`),
    check(
      "note_links_status_check",
      sql`${table.status} in ('suggested', 'confirmed', 'rejected')`,
    ),
    check(
      "note_links_distinct_notes_check",
      sql`${table.source_note_id} <> ${table.target_note_id}`,
    ),
  ],
);

export const noteProcessingSteps = sqliteTable(
  "note_processing_steps",
  {
    id: text("id").primaryKey(),
    note_id: text("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    stage: text("stage", {
      enum: ["transcribe", "describe", "extract", "resolve", "connect"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed", "skipped"],
    }).notNull(),
    detail: text("detail"),
    started_at: text("started_at"),
    finished_at: text("finished_at"),
  },
  (table) => [
    uniqueIndex("note_processing_steps_note_stage_unique").on(
      table.note_id,
      table.stage,
    ),
    index("note_processing_steps_note_idx").on(table.note_id),
    check(
      "note_processing_steps_stage_check",
      sql`${table.stage} in ('transcribe', 'describe', 'extract', 'resolve', 'connect')`,
    ),
    check(
      "note_processing_steps_status_check",
      sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'skipped')`,
    ),
  ],
);

export const triggers = sqliteTable(
  "triggers",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    type: text("type", { enum: ["time", "location"] }).notNull(),
    status: text("status", {
      enum: ["active", "triggered", "cancelled"],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    scheduled_for: text("scheduled_for"),
    timezone: text("timezone"),
    location_label: text("location_label"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    radius_meters: integer("radius_meters"),
    location_event: text("location_event", { enum: ["enter", "exit"] }),
    note_id: text("note_id").references(() => notes.id, {
      onDelete: "cascade",
    }),
    entity_id: text("entity_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    created_at: text("created_at").notNull(),
    triggered_at: text("triggered_at"),
  },
  (table) => [
    index("triggers_user_status_idx").on(table.user_id, table.status),
    index("triggers_scheduled_idx").on(table.scheduled_for, table.status),
    index("triggers_note_idx").on(table.note_id),
    index("triggers_entity_idx").on(table.entity_id),
    check("triggers_type_check", sql`${table.type} in ('time', 'location')`),
    check(
      "triggers_status_check",
      sql`${table.status} in ('active', 'triggered', 'cancelled')`,
    ),
    check(
      "triggers_location_event_check",
      sql`${table.location_event} is null or ${table.location_event} in ('enter', 'exit')`,
    ),
  ],
);

export const deviceTokens = sqliteTable(
  "device_tokens",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    token: text("token").notNull().unique(),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("device_tokens_user_idx").on(table.user_id),
    check(
      "device_tokens_platform_check",
      sql`${table.platform} in ('ios', 'android', 'web')`,
    ),
  ],
);

export const locationEvents = sqliteTable(
  "location_events",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    trigger_id: text("trigger_id").references(() => triggers.id, {
      onDelete: "set null",
    }),
    event: text("event", { enum: ["enter", "exit"] }).notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    occurred_at: text("occurred_at").notNull(),
    received_at: text("received_at").notNull(),
  },
  (table) => [
    index("location_events_user_received_idx").on(
      table.user_id,
      table.received_at,
    ),
    check(
      "location_events_event_check",
      sql`${table.event} in ('enter', 'exit')`,
    ),
  ],
);
