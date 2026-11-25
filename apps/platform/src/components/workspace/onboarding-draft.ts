import { z } from "zod";

// Browser-only setup progress, partitioned by user and organization. Setup
// asks only what a team must decide before its first day (where delivery
// happens, whether content may reach an AI provider, who joins); planning
// and readiness start from the project defaults and are changed in the
// project's settings once the team has met them.
export const steps = {
  project: 0,
  delivery: 1,
  // Retired: a draft saved on this step resumes at Lictory Intelligence.
  planning: 2,
  people: 3,
  intelligence: 4,
} as const;
export const draftSchema = z.object({
  step: z.number().int().min(0).max(4),
  name: z.string().max(120),
  key: z.string().max(10),
  keyTouched: z.boolean(),
  deliveryMode: z.enum(["", "native", "external"]),
  aiEnabled: z.boolean().default(true),
  // Until the person picks, the choice follows whether this server has an
  // AI provider configured.
  aiChosen: z.boolean().default(false),
  invites: z.array(z.string().max(320)).max(50),
});
export type Draft = z.infer<typeof draftSchema>;
export const emptyDraft: Draft = {
  step: steps.project,
  name: "",
  key: "",
  keyTouched: false,
  deliveryMode: "",
  aiEnabled: true,
  aiChosen: false,
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
