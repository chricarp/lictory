import type {
  entities,
  mediaAssets,
  noteEntities,
  noteLinks,
  noteProcessingSteps,
  notes,
  triggers,
} from "./schema";

/** Database row shapes inferred from the canonical Drizzle schema. */
export type MediaRow = typeof mediaAssets.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type EntityRow = typeof entities.$inferSelect & { note_count?: number };
export type NoteEntityRow = typeof noteEntities.$inferSelect;
export type NoteLinkRow = typeof noteLinks.$inferSelect;
export type ProcessingStepRow = typeof noteProcessingSteps.$inferSelect;
export type TriggerRow = typeof triggers.$inferSelect;
