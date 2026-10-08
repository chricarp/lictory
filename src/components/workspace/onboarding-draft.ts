import { z } from "zod";

// Browser-only setup progress, partitioned by user and organization.
export const steps = {
  project: 0,
  delivery: 1,
  planning: 2,
  team: 3,
} as const;
export const draftSchema = z.object({
  step: z.number().int().min(0).max(3),
  name: z.string().max(120),
  key: z.string().max(10),
  keyTouched: z.boolean(),
  deliveryMode: z.enum(["", "native", "external"]),
  readinessPolicy: z.enum(["off", "warn", "block"]),
  iterationMode: z.enum(["", "off", "manual", "automatic"]),
  estimateScale: z.enum(["", "none", "fibonacci", "linear", "tshirt"]),
  iterationWeeks: z.string(),
  iterationStartDay: z.string(),
  invites: z.array(z.string().max(320)).max(50),
});
export type Draft = z.infer<typeof draftSchema>;
export const emptyDraft: Draft = {
  step: steps.project,
  name: "",
  key: "",
  keyTouched: false,
  deliveryMode: "",
  readinessPolicy: "warn",
  iterationMode: "",
  estimateScale: "",
  iterationWeeks: "2",
  iterationStartDay: "1",
  invites: [],
};
export const draftKey = (userId: string, organizationId: string) =>
  `lictory:setup:${userId}:${organizationId}`;

/** Carries the project chosen while creating the organization into setup. */
export function seedSetupDraft(
  userId: string,
  organizationId: string,
  project: { name: string; key: string },
) {
  try {
    sessionStorage.setItem(
      draftKey(userId, organizationId),
      JSON.stringify({
        ...emptyDraft,
        ...project,
        keyTouched: true,
        step: steps.delivery,
      } satisfies Draft),
    );
  } catch {
    /* Setup then starts by asking for the project again. */
  }
}
