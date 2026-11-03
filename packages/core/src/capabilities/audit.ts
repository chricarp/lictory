import { z } from "zod";
import {
  defineCapability,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import { auditCategories } from "@lictory/core/contracts/audit";
import { MAX_AUDIT_PAGE, readAuditLog } from "@lictory/core/domain/audit-log";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31.");

export const auditLogFilterInput = z.object({
  category: z.enum(auditCategories).nullish(),
  actorId: id.nullish(),
  from: day.nullish(),
  to: day.nullish(),
});

const listAuditLog = defineCapability({
  name: "listAuditLog",
  title: "List the audit log",
  description:
    "The organization's audit log, newest first: membership, application roles, invitations, access tokens, configuration changes and agent calls. Organization administrators only.",
  kind: "query",
  surfaces: webOnly,
  humanOnly: {
    reason: "audit",
    where: "Organization settings → Audit log",
  },
  idempotent: true,
  input: auditLogFilterInput.extend({
    organizationId,
    cursor: z.string().max(400).nullish(),
    limit: z.number().int().min(1).max(MAX_AUDIT_PAGE).optional(),
  }),
  run: (ctx, { organizationId, ...options }) =>
    readAuditLog(ctx.db, ctx.principal.userId, organizationId, options),
});

export const auditCapabilities = [listAuditLog] as AnyCapability[];
