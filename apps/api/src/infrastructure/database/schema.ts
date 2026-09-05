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
    ai_analysis: text("ai_analysis"),
    ai_error: text("ai_error"),
    capture_timezone: text("capture_timezone").notNull().default("UTC"),
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

export const askConversations = sqliteTable(
  "ask_conversations",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    title: text("title").notNull(),
    ...timestamps,
  },
  (table) => [
    index("ask_conversations_user_updated_idx").on(
      table.user_id,
      table.updated_at,
    ),
  ],
);

export const askMessages = sqliteTable(
  "ask_messages",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => askConversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    position: integer("position").notNull(),
    content_markdown: text("content_markdown").notNull(),
    citations_json: text("citations_json").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("ask_messages_conversation_position_idx").on(
      table.conversation_id,
      table.position,
    ),
    check(
      "ask_messages_role_check",
      sql`${table.role} in ('user', 'assistant')`,
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
    time_kind: text("time_kind", {
      enum: ["date", "event", "deadline", "reminder"],
    }),
    needs_reminder: integer("needs_reminder").notNull().default(0),
    reminder_reason: text("reminder_reason"),
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
    check(
      "entities_time_kind_check",
      sql`${table.time_kind} is null or ${table.time_kind} in ('date', 'event', 'deadline', 'reminder')`,
    ),
    check(
      "entities_needs_reminder_check",
      sql`${table.needs_reminder} in (0, 1)`,
    ),
  ],
);

/**
 * Every surface form that unambiguously names an entity. The unique index on
 * (user, type, alias_key) is what makes resolution a lookup rather than a scan:
 * "OpenAI Inc." and "MIT" land on the node they belong to directly. Only
 * unambiguous variants are written here — anything merely plausible becomes a
 * duplicate suspicion instead, so an alias can never hijack a future entity.
 */
export const entityAliases = sqliteTable(
  "entity_aliases",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    type: text("type", {
      enum: ["person", "place", "time", "topic", "organization"],
    }).notNull(),
    alias_key: text("alias_key").notNull(),
    entity_id: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["canonical", "observed", "derived", "user"],
    })
      .notNull()
      .default("derived"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("entity_aliases_lookup_idx").on(
      table.user_id,
      table.type,
      table.alias_key,
    ),
    index("entity_aliases_entity_idx").on(table.entity_id),
    check(
      "entity_aliases_source_check",
      sql`${table.source} in ('canonical', 'observed', 'derived', 'user')`,
    ),
  ],
);

/**
 * The normalized form of a place. Address components live here as queryable
 * structure instead of a free-text blob, and `geohash` gives SQLite a
 * prefix-indexable proximity bucket so the resolver can ask "do I already know
 * a place around here?" without a spatial extension.
 *
 * `parent_entity_id` records the broader place an inherited coordinate came
 * from, which keeps a deduced position explainable rather than magic.
 */
export const entityPlaces = sqliteTable(
  "entity_places",
  {
    entity_id: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    formatted_address: text("formatted_address"),
    street: text("street"),
    locality: text("locality"),
    region: text("region"),
    postal_code: text("postal_code"),
    country: text("country"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    geohash: text("geohash"),
    precision: text("precision", {
      enum: ["exact", "street", "locality", "region", "country", "unknown"],
    })
      .notNull()
      .default("unknown"),
    source: text("source", {
      enum: ["model", "inherited", "geocoder", "user"],
    })
      .notNull()
      .default("model"),
    parent_entity_id: text("parent_entity_id"),
    ...timestamps,
  },
  (table) => [
    index("entity_places_geohash_idx").on(table.user_id, table.geohash),
    index("entity_places_locality_idx").on(table.user_id, table.locality),
    check(
      "entity_places_precision_check",
      sql`${table.precision} in ('exact', 'street', 'locality', 'region', 'country', 'unknown')`,
    ),
    check(
      "entity_places_source_check",
      sql`${table.source} in ('model', 'inherited', 'geocoder', 'user')`,
    ),
  ],
);

/**
 * A moment: the authoritative record of when something happens.
 *
 * Timing lives here rather than on `entities` because a moment is not a bag of
 * loose columns — `starts_at`, its precision, its schedule and the notification
 * derived from them only make sense together. The matching columns on
 * `entities` are kept as a mirror for older clients and are written by the same
 * single code path, so the two can never drift.
 *
 * The four shapes the product cares about are all expressible here:
 * a one-off date (`recurrence_freq` null), a birthday or anniversary (yearly,
 * all-day, anchored in the past), a recurring event (any frequency), and a
 * reminder (`needs_reminder`, or `kind = 'reminder'`).
 *
 * `next_occurrence_at` is the denormalized answer to "when is this next?" — the
 * one column a calendar can index and sort by without knowing whether the row
 * repeats. It is recomputed on every write and re-armed when a reminder fires.
 */
export const entityMoments = sqliteTable(
  "entity_moments",
  {
    entity_id: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    user_id: text("user_id").notNull(),
    kind: text("kind", {
      enum: ["date", "event", "deadline", "reminder"],
    })
      .notNull()
      .default("date"),
    precision: text("precision", {
      enum: ["minute", "day", "month", "year", "unknown"],
    })
      .notNull()
      .default("unknown"),
    starts_at: text("starts_at"),
    ends_at: text("ends_at"),
    all_day: integer("all_day").notNull().default(0),
    timezone: text("timezone"),
    recurrence_freq: text("recurrence_freq", {
      enum: ["daily", "weekly", "monthly", "yearly"],
    }),
    recurrence_interval: integer("recurrence_interval").notNull().default(1),
    recurrence_until: text("recurrence_until"),
    /** The schedule as written, kept so a human can see what was interpreted. */
    recurrence_text: text("recurrence_text"),
    next_occurrence_at: text("next_occurrence_at"),
    needs_reminder: integer("needs_reminder").notNull().default(0),
    reminder_reason: text("reminder_reason"),
    remind_at: text("remind_at"),
    trigger_id: text("trigger_id"),
    ...timestamps,
  },
  (table) => [
    index("entity_moments_next_idx").on(
      table.user_id,
      table.next_occurrence_at,
    ),
    index("entity_moments_remind_idx").on(table.user_id, table.remind_at),
    check(
      "entity_moments_kind_check",
      sql`${table.kind} in ('date', 'event', 'deadline', 'reminder')`,
    ),
    check(
      "entity_moments_precision_check",
      sql`${table.precision} in ('minute', 'day', 'month', 'year', 'unknown')`,
    ),
    check(
      "entity_moments_recurrence_check",
      sql`${table.recurrence_freq} is null or ${table.recurrence_freq} in ('daily', 'weekly', 'monthly', 'yearly')`,
    ),
    check("entity_moments_all_day_check", sql`${table.all_day} in (0, 1)`),
    check(
      "entity_moments_needs_reminder_check",
      sql`${table.needs_reminder} in (0, 1)`,
    ),
  ],
);

/**
 * A pair the resolver thinks might be the same node but is not certain enough
 * to collapse on its own. Recorded rather than acted on, because silently
 * fusing two people who share a first name is the one mistake the graph cannot
 * recover from.
 */
export const entityDuplicates = sqliteTable(
  "entity_duplicates",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    type: text("type", {
      enum: ["person", "place", "time", "topic", "organization"],
    }).notNull(),
    entity_id: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    candidate_entity_id: text("candidate_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    reason: text("reason"),
    status: text("status", { enum: ["open", "dismissed", "merged"] })
      .notNull()
      .default("open"),
    created_at: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("entity_duplicates_pair_idx").on(
      table.entity_id,
      table.candidate_entity_id,
    ),
    index("entity_duplicates_user_idx").on(table.user_id, table.status),
    check(
      "entity_duplicates_status_check",
      sql`${table.status} in ('open', 'dismissed', 'merged')`,
    ),
    check(
      "entity_duplicates_distinct_check",
      sql`${table.entity_id} <> ${table.candidate_entity_id}`,
    ),
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
    /**
     * Whether the pipeline armed this reminder or the user did. Auto-armed
     * reminders are visibly the AI's doing and cancellable in one tap.
     */
    origin: text("origin", { enum: ["ai", "user"] })
      .notNull()
      .default("user"),
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
    check("triggers_origin_check", sql`${table.origin} in ('ai', 'user')`),
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
