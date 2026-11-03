import { z } from "zod";
import {
  defineCapability,
  organizationId,
  webOnly,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import {
  listOrganizationExports,
  requestOrganizationExport,
} from "@lictory/core/export/service";

const where = "Organization settings → Data export";

const requestExport = defineCapability({
  name: "requestOrganizationExport",
  title: "Export the organization's data",
  description:
    "Queue an export of every project, work item, revision, approval, discussion, decision and member of the organization as a downloadable archive. Organization administrators only; one export runs at a time.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "export", where },
  idempotent: true,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    requestOrganizationExport(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
    ),
});

const listExports = defineCapability({
  name: "listOrganizationExports",
  title: "List data exports",
  description:
    "The organization's recent data exports with their status and expiry. Organization administrators only.",
  kind: "query",
  surfaces: webOnly,
  humanOnly: { reason: "export", where },
  idempotent: true,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    listOrganizationExports(ctx.db, ctx.principal.userId, input.organizationId),
});

export const exportCapabilities = [
  requestExport,
  listExports,
] as AnyCapability[];
