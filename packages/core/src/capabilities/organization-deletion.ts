import { z } from "zod";
import {
  defineCapability,
  organizationId,
  webOnly,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import {
  cancelOrganizationDeletion,
  scheduleOrganizationDeletion,
} from "@lictory/core/domain/organization-deletion";
import { instancePolicy } from "@lictory/core/lib/instance-policy";

const where = "Organization settings → Delete organization";

const schedule = defineCapability({
  name: "scheduleOrganizationDeletion",
  title: "Schedule the organization's deletion",
  description:
    "Lock the organization now and permanently delete it, with its files and delivery credentials, after the installation's grace period. Owners only; confirm with the organization's handle.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "deletion", where },
  whileDeletionScheduled: "owners",
  destructive: true,
  idempotent: true,
  input: z.object({
    organizationId,
    confirmation: z.string().max(200),
  }),
  run: (ctx, input) =>
    scheduleOrganizationDeletion(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
      {
        confirmation: input.confirmation,
        // Validated when the API starts.
        graceDays: instancePolicy(process.env).organizationDeletionGraceDays,
      },
    ),
});

const cancel = defineCapability({
  name: "cancelOrganizationDeletion",
  title: "Cancel the organization's deletion",
  description:
    "Cancel a scheduled deletion during the grace period and open the organization again. Owners only.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "deletion", where },
  whileDeletionScheduled: "owners",
  idempotent: true,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    cancelOrganizationDeletion(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
    ),
});

export const organizationDeletionCapabilities = [
  schedule,
  cancel,
] as AnyCapability[];
