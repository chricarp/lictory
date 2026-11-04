import { and, eq, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  applicationRoleOf,
  type Command,
} from "@lictory/core/contracts/protocol";
import type { AuditAction } from "@lictory/core/contracts/audit";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database, Tx } from "@lictory/core/domain/service";

// The organization audit log: who did what, when, to whom. See
// docs/internals/audit.md for what is recorded and how long it is kept.
//
// Three append-only sources are read together:
// - `audit_event`: security-relevant events (membership, application roles,
//   invitations, access tokens, exports), written by `recordAuditEvent`;
// - `configuration_audit`: configuration commands (`auditConfiguration`);
// - `capability_invocation`: calls made by agents (MCP clients and Litto).

// Configuration changes keep their actor, command and previous definition.
export async function auditConfiguration(
  tx: Tx,
  organizationId: string,
  actorId: string,
  command: Command,
  previous?: unknown,
) {
  await tx.insert(s.configurationAudit).values({
    organizationId,
    actorId,
    action: command.type,
    detail: { command, ...(previous === undefined ? {} : { previous }) },
  });
}

export type AuditActor = {
  id: string;
  // Snapshot at the time; looked up from the account when omitted.
  name?: string | null;
  email?: string | null;
};

export type AuditRecord = {
  organizationId: string;
  // Null when Lictory itself acted (a scheduled job, a cascade).
  actor: AuditActor | null;
  action: AuditAction;
  target?: { type: string; id: string; label?: string | null } | null;
  // Facts an administrator needs to understand the event. Never secrets,
  // credentials or specification content.
  detail?: Record<string, unknown>;
};

const actorSnapshot = (actor: AuditActor | null, field: "name" | "email") => {
  if (!actor) return null;
  const given = actor[field];
  if (given !== undefined) return given;
  const column = field === "name" ? s.user.name : s.user.email;
  return sql`(select ${column} from ${s.user} where ${s.user.id} = ${actor.id})`;
};

// Records one audit event. Call it inside the transaction that makes the
// change, so the change and its record commit together:
//
//   await db.transaction(async (tx) => {
//     ...the change...
//     await recordAuditEvent(tx, { organizationId, actor: { id: userId },
//       action: "member.role_changed", target: { type: "member", id } });
//   });
//
// Writes owned by Better Auth commit on their own; their hooks call this
// right after (see lib/auth.ts).
export async function recordAuditEvent(db: Database | Tx, record: AuditRecord) {
  await db.insert(s.auditEvent).values({
    organizationId: record.organizationId,
    actorId: record.actor?.id ?? null,
    actorName: actorSnapshot(record.actor, "name"),
    actorEmail: actorSnapshot(record.actor, "email"),
    action: record.action,
    targetType: record.target?.type ?? null,
    targetId: record.target?.id ?? null,
    targetLabel: record.target?.label ?? null,
    detail: record.detail ?? {},
  });
}

// Records an account-level event (an access token, a sign-in method) in every
// organization the person currently belongs to: the change affects what can
// act in each of them. One statement, in the caller's transaction.
export async function recordAccountAuditEvent(
  db: Database | Tx,
  userId: string,
  record: Omit<AuditRecord, "organizationId">,
) {
  const actorId = record.actor?.id ?? null;
  await db.execute(sql`
    insert into audit_event
      (id, organization_id, actor_id, actor_name, actor_email, action,
       target_type, target_id, target_label, detail)
    select gen_random_uuid()::text, m.organization_id, ${actorId}::text,
      coalesce(${record.actor?.name ?? null}::text, u.name),
      coalesce(${record.actor?.email ?? null}::text, u.email),
      ${record.action}::text, ${record.target?.type ?? null}::text,
      ${record.target?.id ?? null}::text, ${record.target?.label ?? null}::text,
      ${JSON.stringify(record.detail ?? {})}::jsonb
    from member m
    left join "user" u on u.id = ${actorId}::text
    where m.user_id = ${userId}`);
}

// Who may read the audit log: organization administrators.
export async function canReadAuditLog(
  db: Database | Tx,
  userId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ role: s.member.role })
    .from(s.member)
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, userId),
      ),
    );
  return Boolean(row && applicationRoleOf(row.role) === "admin");
}

export async function requireAuditReader(
  db: Database | Tx,
  userId: string,
  organizationId: string,
) {
  if (!(await canReadAuditLog(db, userId, organizationId)))
    throw new DomainError(
      "forbidden",
      "Only organization administrators can view the audit log.",
    );
}
