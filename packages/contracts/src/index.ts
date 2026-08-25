import { z } from "zod";

export * from "./geofence";
export * from "./moments";
export * from "./notes";
export * from "./resolution";

export const mediaKindSchema = z.enum(["image", "audio", "document"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const processingStatusSchema = z.enum([
  "pending_upload",
  "uploaded",
  "queued",
  "processing",
  "completed",
  "failed",
]);
export type ProcessingStatus = z.infer<typeof processingStatusSchema>;

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  kind: mediaKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  status: processingStatusSchema,
  aiResult: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const createUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(127),
  bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

export const createUploadResponseSchema = z.object({
  asset: mediaAssetSchema,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const completeUploadResponseSchema = z.object({
  asset: mediaAssetSchema,
});
export type CompleteUploadResponse = z.infer<
  typeof completeUploadResponseSchema
>;

const triggerMessageSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(500),
});

export const timeTriggerInputSchema = triggerMessageSchema.extend({
  type: z.literal("time"),
  scheduledFor: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(64),
});

export const locationTriggerInputSchema = triggerMessageSchema.extend({
  type: z.literal("location"),
  label: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(100).max(100_000),
  event: z.enum(["enter", "exit"]),
});

export const createTriggerRequestSchema = z.discriminatedUnion("type", [
  timeTriggerInputSchema,
  locationTriggerInputSchema,
]);
export type CreateTriggerRequest = z.infer<typeof createTriggerRequestSchema>;

export const triggerSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "triggered", "cancelled"]),
  createdAt: z.string(),
  triggeredAt: z.string().nullable(),
  ...triggerMessageSchema.shape,
  type: z.enum(["time", "location"]),
  scheduledFor: z.string().nullable(),
  timezone: z.string().nullable(),
  label: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  radiusMeters: z.number().nullable(),
  event: z.enum(["enter", "exit"]).nullable(),
  /** Whether the understanding pipeline armed this, or the user did. */
  origin: z.enum(["ai", "user"]),
  noteId: z.string().nullable(),
  entityId: z.string().nullable(),
});
export type Trigger = z.infer<typeof triggerSchema>;

export const registerDeviceRequestSchema = z.object({
  token: z.string().trim().min(1).max(512),
  platform: z.enum(["ios", "android", "web"]),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const locationEventRequestSchema = z.object({
  triggerId: z.string().uuid().optional(),
  event: z.enum(["enter", "exit"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type LocationEventRequest = z.infer<typeof locationEventRequestSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
