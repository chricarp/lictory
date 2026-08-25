import type {
  entities,
  entityAliases,
  entityDuplicates,
  entityMoments,
  entityPlaces,
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
export type EntityRow = typeof entities.$inferSelect & {
  note_count?: number;
  /** Joined facets, present only when a query asks for them. */
  place?: EntityPlaceRow | null;
  moment?: EntityMomentRow | null;
};
export type NoteEntityRow = typeof noteEntities.$inferSelect;
export type NoteLinkRow = typeof noteLinks.$inferSelect;
export type ProcessingStepRow = typeof noteProcessingSteps.$inferSelect;
export type TriggerRow = typeof triggers.$inferSelect;
export type EntityAliasRow = typeof entityAliases.$inferSelect;
export type EntityPlaceRow = typeof entityPlaces.$inferSelect;
export type EntityMomentRow = typeof entityMoments.$inferSelect & {
  /** Joined from `triggers` so a facet can say whether it is really armed. */
  trigger_status?: "active" | "triggered" | "cancelled" | null;
};
export type EntityDuplicateRow = typeof entityDuplicates.$inferSelect;
