import { z } from "zod";

import { momentRecurrenceSchema } from "./moments";

/* -------------------------------------------------------------------------- */
/*                                 Attachments                                */
/* -------------------------------------------------------------------------- */

export const attachmentKindSchema = z.enum(["image", "audio", "document"]);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentStatusSchema = z.enum([
  "pending_upload",
  "uploaded",
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  noteId: z.string().nullable(),
  kind: attachmentKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  status: attachmentStatusSchema,
  /** Whisper transcript, vision caption or extracted document text. */
  aiResult: z.string().nullable(),
  failureReason: z.string().nullable(),
  /** Seconds — only present for audio captured in-app. */
  durationSeconds: z.number().nonnegative().nullable(),
  position: z.number().int().nonnegative(),
  url: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/* -------------------------------------------------------------------------- */
/*                                  Entities                                  */
/* -------------------------------------------------------------------------- */

export const entityTypeSchema = z.enum([
  "person",
  "place",
  "time",
  "topic",
  "organization",
]);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const originSchema = z.enum(["ai", "user"]);
export type Origin = z.infer<typeof originSchema>;

export const timeKindSchema = z.enum(["date", "event", "deadline", "reminder"]);
export type TimeKind = z.infer<typeof timeKindSchema>;

/* ------------------------------ Place facet ------------------------------ */

/** How specific a place's coordinates are, which governs how far they can be trusted. */
export const placePrecisionSchema = z.enum([
  "exact",
  "street",
  "locality",
  "region",
  "country",
  "unknown",
]);
export type PlacePrecision = z.infer<typeof placePrecisionSchema>;

/** Where a place's coordinates came from. `user` outranks everything else. */
export const placeSourceSchema = z.enum([
  "model",
  "inherited",
  "geocoder",
  "user",
]);
export type PlaceSource = z.infer<typeof placeSourceSchema>;

export const addressPartsSchema = z.object({
  street: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});
export type AddressParts = z.infer<typeof addressPartsSchema>;

/**
 * The normalized form of a place, kept in its own table so an address is
 * queryable structure rather than a free-text string. `parentEntityId` records
 * the broader place a coordinate was inherited from, so an inherited position
 * is always explainable and can be re-derived if the parent is corrected.
 */
export const entityPlaceSchema = addressPartsSchema.extend({
  formattedAddress: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geohash: z.string().nullable(),
  precision: placePrecisionSchema,
  source: placeSourceSchema,
  parentEntityId: z.string().nullable(),
});
export type EntityPlace = z.infer<typeof entityPlaceSchema>;

export const updatePlaceRequestSchema = addressPartsSchema.partial().extend({
  formattedAddress: z.string().trim().max(400).nullish(),
});
export type UpdatePlaceRequest = z.infer<typeof updatePlaceRequestSchema>;

/* ----------------------------- Moment facet ------------------------------ */

/** How specific an extracted timestamp is. Imprecise moments are never scheduled. */
export const momentPrecisionSchema = z.enum([
  "minute",
  "day",
  "month",
  "year",
  "unknown",
]);
export type MomentPrecision = z.infer<typeof momentPrecisionSchema>;

/**
 * The normalized form of a moment. `kind` is its objective — plain context, a
 * thing that happens, a thing that is due, or an explicit ask to be reminded —
 * and `remindAt` is the instant derived from that objective. `triggerId` is the
 * armed notification, present only when one is actually scheduled.
 */
export const entityMomentSchema = z.object({
  kind: timeKindSchema,
  precision: momentPrecisionSchema,
  /**
   * The moment's own timing. These are authoritative: the matching columns on
   * `entities` are a legacy mirror kept only so older clients keep reading.
   */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  /**
   * The evaluated schedule. A birthday is a yearly, all-day moment anchored in
   * the past rather than a distinct kind of thing.
   */
  recurrence: momentRecurrenceSchema.nullable(),
  /**
   * The first occurrence at or after the moment was last written. This is the
   * column the calendar sorts by, so a one-off and the next instance of a
   * repeating moment answer the same question the same way.
   */
  nextOccurrenceAt: z.string().nullable(),
  needsReminder: z.boolean(),
  remindAt: z.string().nullable(),
  triggerId: z.string().nullable(),
  /**
   * Whether a notification is actually scheduled. A moment keeps pointing at a
   * cancelled trigger on purpose — that link is the record of a human turning
   * the reminder off, and it is what stops re-processing from arming a new one.
   */
  armed: z.boolean(),
  reminderReason: z.string().nullable(),
});
export type EntityMoment = z.infer<typeof entityMomentSchema>;

/* --------------------------- Duplicate review ---------------------------- */

export const duplicateStatusSchema = z.enum(["open", "dismissed", "merged"]);
export type DuplicateStatus = z.infer<typeof duplicateStatusSchema>;

export const entitySchema = z.object({
  id: z.string(),
  type: entityTypeSchema,
  name: z.string(),
  normalizedKey: z.string(),
  description: z.string().nullable(),
  /* place */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  radiusMeters: z.number().int().nullable(),
  address: z.string().nullable(),
  /* time */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  timezone: z.string().nullable(),
  recurrence: z.string().nullable(),
  timeKind: timeKindSchema.nullable(),
  needsReminder: z.boolean(),
  reminderReason: z.string().nullable(),
  /* presentation */
  color: z.string().nullable(),
  origin: originSchema,
  noteCount: z.number().int().nonnegative().optional(),
  /**
   * Normalized facets. Present only for the type they belong to, and only once
   * the resolver has run — a hand-created place has an address string before it
   * has structure.
   */
  place: entityPlaceSchema.nullish(),
  moment: entityMomentSchema.nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Entity = z.infer<typeof entitySchema>;

/** A pair the resolver thinks might be the same node, awaiting a human. */
export const duplicateSuspicionSchema = z.object({
  id: z.string(),
  type: entityTypeSchema,
  score: z.number().min(0).max(1),
  reason: z.string().nullable(),
  status: duplicateStatusSchema,
  entity: entitySchema,
  candidate: entitySchema,
  createdAt: z.string(),
});
export type DuplicateSuspicion = z.infer<typeof duplicateSuspicionSchema>;

export const entityInputSchema = z.object({
  type: entityTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1_000).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  radiusMeters: z.number().int().min(25).max(200_000).nullish(),
  address: z.string().trim().max(400).nullish(),
  /* structured place — lets a human correct what the resolver deduced */
  street: z.string().trim().max(200).nullish(),
  locality: z.string().trim().max(120).nullish(),
  region: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(32).nullish(),
  country: z.string().trim().max(120).nullish(),
  startsAt: z.string().trim().max(64).nullish(),
  endsAt: z.string().trim().max(64).nullish(),
  allDay: z.boolean().nullish(),
  timezone: z.string().trim().max(64).nullish(),
  /** Free-text schedule as written or extracted; parsed server-side. */
  recurrence: z.string().trim().max(200).nullish(),
  /** Structured schedule. Wins over `recurrence` when both are supplied. */
  recurrenceRule: momentRecurrenceSchema.nullish(),
  timeKind: timeKindSchema.nullish(),
  needsReminder: z.boolean().nullish(),
  reminderReason: z.string().trim().max(1_000).nullish(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});
export type EntityInput = z.infer<typeof entityInputSchema>;

export const updateEntityRequestSchema = entityInputSchema.partial();
export type UpdateEntityRequest = z.infer<typeof updateEntityRequestSchema>;

/* -------------------------------------------------------------------------- */
/*                              Note ↔ Entity edge                            */
/* -------------------------------------------------------------------------- */

export const entityRoleSchema = z.enum([
  "mentions",
  "about",
  "happens_at",
  "located_at",
  "with_person",
]);
export type EntityRole = z.infer<typeof entityRoleSchema>;

export const linkStatusSchema = z.enum(["suggested", "confirmed", "rejected"]);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

export const noteEntitySchema = z.object({
  entity: entitySchema,
  role: entityRoleSchema,
  confidence: z.number().min(0).max(1),
  origin: originSchema,
  status: linkStatusSchema,
  mention: z.string().nullable(),
  createdAt: z.string(),
});
export type NoteEntity = z.infer<typeof noteEntitySchema>;

export const attachEntityRequestSchema = z.object({
  entityId: z.string().optional(),
  entity: entityInputSchema.optional(),
  role: entityRoleSchema.default("mentions"),
  status: linkStatusSchema.default("confirmed"),
  mention: z.string().trim().max(280).nullish(),
});
export type AttachEntityRequest = z.infer<typeof attachEntityRequestSchema>;

export const updateNoteEntityRequestSchema = z.object({
  role: entityRoleSchema.optional(),
  status: linkStatusSchema.optional(),
});
export type UpdateNoteEntityRequest = z.infer<
  typeof updateNoteEntityRequestSchema
>;

/* -------------------------------------------------------------------------- */
/*                              Note ↔ Note edge                              */
/* -------------------------------------------------------------------------- */

export const noteRelationSchema = z.enum([
  "related",
  "follow_up",
  "duplicate",
  "references",
]);
export type NoteRelation = z.infer<typeof noteRelationSchema>;

export const noteLinkSchema = z.object({
  id: z.string(),
  relation: noteRelationSchema,
  direction: z.enum(["outgoing", "incoming"]),
  confidence: z.number().min(0).max(1),
  origin: originSchema,
  status: linkStatusSchema,
  reason: z.string().nullable(),
  note: z.object({
    id: z.string(),
    title: z.string().nullable(),
    excerpt: z.string(),
    createdAt: z.string(),
  }),
  createdAt: z.string(),
});
export type NoteLink = z.infer<typeof noteLinkSchema>;

export const createNoteLinkRequestSchema = z.object({
  targetNoteId: z.string(),
  relation: noteRelationSchema.default("related"),
  reason: z.string().trim().max(500).nullish(),
});
export type CreateNoteLinkRequest = z.infer<typeof createNoteLinkRequestSchema>;

/* -------------------------------------------------------------------------- */
/*                            Processing lifecycle                            */
/* -------------------------------------------------------------------------- */

export const noteStatusSchema = z.enum([
  "draft",
  "queued",
  "processing",
  "ready",
  "failed",
]);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

export const processingStageSchema = z.enum([
  "transcribe",
  "describe",
  "extract",
  "resolve",
  "connect",
]);
export type ProcessingStage = z.infer<typeof processingStageSchema>;

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const processingStepSchema = z.object({
  id: z.string(),
  stage: processingStageSchema,
  status: stageStatusSchema,
  detail: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type ProcessingStep = z.infer<typeof processingStepSchema>;

/* -------------------------------------------------------------------------- */
/*                                    Note                                    */
/* -------------------------------------------------------------------------- */

export const noteSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  excerpt: z.string(),
  status: noteStatusSchema,
  aiSummary: z.string().nullable(),
  aiAnalysis: z.string().nullable(),
  aiError: z.string().nullable(),
  captureTimezone: z.string(),
  occurredAt: z.string().nullable(),
  pinned: z.boolean(),
  counts: z.object({
    attachments: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    audio: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    people: z.number().int().nonnegative(),
    places: z.number().int().nonnegative(),
    times: z.number().int().nonnegative(),
    topics: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
  }),
  highlights: z.array(
    z.object({
      id: z.string(),
      type: entityTypeSchema,
      name: z.string(),
      status: linkStatusSchema,
    }),
  ),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteSchema = noteSummarySchema.extend({
  bodyMarkdown: z.string(),
  attachments: z.array(attachmentSchema),
  entities: z.array(noteEntitySchema),
  links: z.array(noteLinkSchema),
  steps: z.array(processingStepSchema),
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteRequestSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  bodyMarkdown: z.string().max(100_000).optional(),
  occurredAt: z.string().trim().max(64).nullish(),
  captureTimezone: z.string().trim().min(1).max(64).optional(),
});
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>;

export const updateNoteRequestSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  bodyMarkdown: z.string().max(100_000).optional(),
  occurredAt: z.string().trim().max(64).nullish(),
  pinned: z.boolean().optional(),
});
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>;

export const createAttachmentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(127),
  bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
  durationSeconds: z
    .number()
    .nonnegative()
    .max(60 * 60 * 8)
    .nullish(),
});
export type CreateAttachmentRequest = z.infer<
  typeof createAttachmentRequestSchema
>;

export const listNotesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: noteStatusSchema.optional(),
  entityId: z.string().optional(),
  entityType: entityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

export const listNotesResponseSchema = z.object({
  notes: z.array(noteSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListNotesResponse = z.infer<typeof listNotesResponseSchema>;

/* -------------------------------------------------------------------------- */
/*                              Ask your context                              */
/* -------------------------------------------------------------------------- */

export const askSourceKindSchema = z.enum([
  "body",
  "audio",
  "image",
  "document",
  "context",
]);
export type AskSourceKind = z.infer<typeof askSourceKindSchema>;

/** A grounded note excerpt that supports an answer. */
export const askCitationSchema = z.object({
  noteId: z.string(),
  title: z.string().nullable(),
  excerpt: z.string(),
  sourceKinds: z.array(askSourceKindSchema).min(1),
});
export type AskCitation = z.infer<typeof askCitationSchema>;

export const askMessageRoleSchema = z.enum(["user", "assistant"]);
export type AskMessageRole = z.infer<typeof askMessageRoleSchema>;

/**
 * One turn in an Ask conversation. Assistant messages keep their citation
 * snapshot beside the answer so a regenerated turn never changes the evidence
 * shown for an older answer.
 */
export const askMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: askMessageRoleSchema,
  contentMarkdown: z.string(),
  citations: z.array(askCitationSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AskMessage = z.infer<typeof askMessageSchema>;

export const askConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AskConversationSummary = z.infer<
  typeof askConversationSummarySchema
>;

export const askConversationSchema = askConversationSummarySchema.extend({
  messages: z.array(askMessageSchema),
});
export type AskConversation = z.infer<typeof askConversationSchema>;

export const askPromptSchema = z.string().trim().min(2).max(1_000);

export const createAskConversationRequestSchema = z.object({
  message: askPromptSchema,
});
export type CreateAskConversationRequest = z.infer<
  typeof createAskConversationRequestSchema
>;

export const createAskMessageRequestSchema = z.object({
  message: askPromptSchema,
});
export type CreateAskMessageRequest = z.infer<
  typeof createAskMessageRequestSchema
>;

export const updateAskMessageRequestSchema = z.object({
  message: askPromptSchema,
});
export type UpdateAskMessageRequest = z.infer<
  typeof updateAskMessageRequestSchema
>;

export const listAskConversationsResponseSchema = z.object({
  conversations: z.array(askConversationSummarySchema),
});
export type ListAskConversationsResponse = z.infer<
  typeof listAskConversationsResponseSchema
>;

/**
 * `type` stays for compatibility with the Expo client. `types` is the
 * comma-separated form the directories use, so People can render People and
 * Organisations from a single request instead of two racing ones.
 */
export const listEntitiesQuerySchema = z.object({
  type: entityTypeSchema.optional(),
  types: z
    .string()
    .trim()
    .transform((value) => value.split(",").map((part) => part.trim()))
    .pipe(z.array(entityTypeSchema).min(1).max(5))
    .optional(),
  q: z.string().trim().max(200).optional(),
});
export type ListEntitiesQuery = z.infer<typeof listEntitiesQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                          Structured AI extraction                          */
/* -------------------------------------------------------------------------- */

/**
 * Shape the LLM is constrained to. Kept intentionally flat and permissive so a
 * small instruct model can satisfy it; every field is re-validated and
 * normalized server side before it is written to the relational store.
 */
export const extractionSchema = z.object({
  title: z.string().max(200).nullish(),
  summary: z.string().max(1_000).nullish(),
  analysis: z.string().max(6_000).nullish(),
  people: z
    .array(
      z.object({
        name: z.string().max(200),
        description: z.string().max(1_000).nullish(),
        mention: z.string().max(280).nullish(),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .default([]),
  places: z
    .array(
      z.object({
        name: z.string().max(200),
        address: z.string().max(400).nullish(),
        latitude: z.number().nullish(),
        longitude: z.number().nullish(),
        description: z.string().max(1_000).nullish(),
        mention: z.string().max(280).nullish(),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .default([]),
  times: z
    .array(
      z.object({
        label: z.string().max(200),
        startsAt: z.string().max(64).nullish(),
        endsAt: z.string().max(64).nullish(),
        allDay: z.boolean().nullish(),
        timezone: z.string().max(64).nullish(),
        recurrence: z.string().max(200).nullish(),
        kind: timeKindSchema,
        needsReminder: z.boolean(),
        reason: z.string().max(1_000).nullish(),
        mention: z.string().max(280).nullish(),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .default([]),
  organizations: z
    .array(
      z.object({
        name: z.string().max(200),
        description: z.string().max(1_000).nullish(),
        mention: z.string().max(280).nullish(),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .default([]),
  topics: z
    .array(
      z.object({
        name: z.string().max(200),
        confidence: z.number().min(0).max(1).nullish(),
      }),
    )
    .default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;

/* -------------------------------------------------------------------------- */
/*                              Graph / discovery                             */
/* -------------------------------------------------------------------------- */

export const graphOverviewSchema = z.object({
  totals: z.object({
    notes: z.number().int(),
    processing: z.number().int(),
    people: z.number().int(),
    places: z.number().int(),
    times: z.number().int(),
    topics: z.number().int(),
  }),
  people: z.array(entitySchema),
  places: z.array(entitySchema),
  upcoming: z.array(entitySchema),
  topics: z.array(entitySchema),
});
export type GraphOverview = z.infer<typeof graphOverviewSchema>;

export function normalizeEntityKey(type: EntityType, name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return type === "person" ? base.replace(/^(mr|mrs|ms|dr)\s+/, "") : base;
}
