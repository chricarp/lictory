import { eq } from "drizzle-orm";
import { db } from "@lictory/core/db";
import * as s from "@lictory/core/db/schema";
import { recordAuditEvent, type AuditActor } from "@lictory/core/domain/audit";
import {
  plannedAuthAudit,
  type Planned,
} from "@lictory/core/lib/auth-audit-plan";

// Audit records for membership changes made through Better Auth. Better Auth
// commits these writes itself (its adapter runs without our transaction), so
// its after hook records them immediately after the change commits. Only
// successful calls reach here; a failed audit write is logged, never turned
// into an error for a change that already happened.

async function write(planned: Planned) {
  const { targetUserId, ...event } = planned;
  if (targetUserId && event.target && !event.target.label) {
    const [account] = await db
      .select({ name: s.user.name, email: s.user.email })
      .from(s.user)
      .where(eq(s.user.id, targetUserId));
    if (account)
      event.target = { ...event.target, label: account.name || account.email };
    event.detail = { ...event.detail, email: account?.email ?? null };
  }
  await recordAuditEvent(db, event);
}

function logFailure(action: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: "audit.write_failed",
      action,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export async function recordAuthAudit(
  path: string,
  body: unknown,
  returned: unknown,
  actor: AuditActor | null,
) {
  const planned = plannedAuthAudit(path, body, returned, actor);
  if (!planned) return;
  try {
    await write(planned);
  } catch (error) {
    logFailure(planned.action, error);
  }
}

// An account deletion removes the person from every organization; each of
// them records it. The account row is already gone, so the actor's name and
// email come from the deleted user.
export async function recordAccountDeleted(
  user: { id: string; name: string; email: string },
  organizationIds: readonly string[],
) {
  for (const organizationId of organizationIds)
    try {
      await recordAuditEvent(db, {
        organizationId,
        actor: { id: user.id, name: user.name, email: user.email },
        action: "member.account_deleted",
        target: { type: "member", id: user.id, label: user.name || user.email },
      });
    } catch (error) {
      logFailure("member.account_deleted", error);
    }
}
