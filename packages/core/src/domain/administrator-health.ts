import {
  and,
  count,
  desc,
  eq,
  gt,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
} from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database } from "@lictory/core/domain/service";
import { authorize, isAdmin } from "@lictory/core/domain/service";
import { DomainError } from "@lictory/core/domain/errors";
import { isInstanceAdmin } from "@lictory/core/lib/instance-policy";

// What the server already knows is wrong with an organization's background
// work, for the "Needs an administrator" card on its administrators' Home
// (docs/operations/deployment.md#monitoring). These are the instance
// monitor's own database checks (deploy/monitor/checks.sql), narrowed to
// the organization; the replication slot's health, an instance-wide fact,
// is added only for instance administrators. Backups are checked by the
// monitor on the server's disk, which the application cannot see.
//
// Read-only and derived: nothing here is stored or configured, and the
// answer is empty while all is well.

export type AdministratorProblem = {
  key:
    | "background_work"
    | "email_failed"
    | "intelligence_failed"
    | "handoff_failed"
    | "replication";
  title: string;
  detail: string;
  // A project's hand-off view, when one project's work is concerned.
  projectId?: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Same thresholds as the monitor.
const WAITING = 15 * MINUTE;
const EMAIL_LATE = 30 * MINUTE;
const DAY = 24 * HOUR;
const SLOT_LAG_BYTES = 2 * 1024 ** 3;

export async function readAdministratorHealth(
  db: Database,
  userId: string,
  organizationId: string,
  now = new Date(),
): Promise<{ problems: AdministratorProblem[] }> {
  const membership = await authorize(db, userId, organizationId);
  if (!isAdmin(membership))
    throw new DomainError(
      "forbidden",
      "Only organization administrators see the organization's health.",
    );
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const problems: AdministratorProblem[] = [];

  // Background work the worker has not reached: notifications to fan out,
  // email past its retry time, Lictory Intelligence runs never started.
  const [events] = await db
    .select({ waiting: count() })
    .from(s.notificationEvent)
    .where(
      and(
        eq(s.notificationEvent.organizationId, organizationId),
        isNull(s.notificationEvent.failedAt),
        lt(s.notificationEvent.nextAttemptAt, ago(WAITING)),
      ),
    );
  const [emails] = await db
    .select({ waiting: count() })
    .from(s.notificationEmail)
    .where(
      and(
        eq(s.notificationEmail.organizationId, organizationId),
        eq(s.notificationEmail.status, "pending"),
        lt(s.notificationEmail.nextAttemptAt, ago(EMAIL_LATE)),
        or(
          isNull(s.notificationEmail.leaseUntil),
          lt(s.notificationEmail.leaseUntil, now),
        ),
      ),
    );
  const [queuedRuns] = await db
    .select({ waiting: count() })
    .from(s.aiRun)
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        eq(s.aiRun.status, "queued"),
        lt(s.aiRun.createdAt, ago(WAITING)),
      ),
    );
  const waiting =
    (events?.waiting ?? 0) +
    (emails?.waiting ?? 0) +
    (queuedRuns?.waiting ?? 0);
  if (waiting > 0)
    problems.push({
      key: "background_work",
      title: "Background work is not being processed",
      detail: `${waiting} ${waiting === 1 ? "task has" : "tasks have"} waited more than 15 minutes (notifications, email or Lictory Intelligence). The server's worker may be stopped or overloaded: whoever runs this server checks it (lictory status).`,
    });

  // Email that failed for good in the last day.
  const [failedEmail] = await db
    .select({ failed: count(), latest: max(s.notificationEmail.lastError) })
    .from(s.notificationEmail)
    .where(
      and(
        eq(s.notificationEmail.organizationId, organizationId),
        eq(s.notificationEmail.status, "failed"),
        gt(s.notificationEmail.createdAt, ago(DAY)),
      ),
    );
  if (failedEmail && failedEmail.failed > 0)
    problems.push({
      key: "email_failed",
      title:
        failedEmail.failed === 1
          ? "1 notification email could not be sent"
          : `${failedEmail.failed} notification emails could not be sent`,
      detail: `In the last day${
        failedEmail.latest ? `; the latest error: ${failedEmail.latest}` : ""
      }. Whoever runs this server checks its email settings (lictory doctor).`,
    });

  // Lictory Intelligence runs that failed in the last day or are stuck.
  const [runs] = await db
    .select({
      failed:
        sql<number>`count(*) filter (where ${s.aiRun.status} = 'failed')`.mapWith(
          Number,
        ),
      stuck:
        sql<number>`count(*) filter (where ${s.aiRun.status} = 'running')`.mapWith(
          Number,
        ),
    })
    .from(s.aiRun)
    .where(
      and(
        eq(s.aiRun.organizationId, organizationId),
        or(
          and(
            eq(s.aiRun.status, "failed"),
            or(
              gt(s.aiRun.completedAt, ago(DAY)),
              and(isNull(s.aiRun.completedAt), gt(s.aiRun.createdAt, ago(DAY))),
            ),
          ),
          and(
            eq(s.aiRun.status, "running"),
            lt(s.aiRun.startedAt, ago(2 * WAITING)),
          ),
        ),
      ),
    );
  if (runs && (runs.failed > 0 || runs.stuck > 0)) {
    const [latest] = runs.failed
      ? await db
          .select({ error: s.aiRun.error })
          .from(s.aiRun)
          .where(
            and(
              eq(s.aiRun.organizationId, organizationId),
              eq(s.aiRun.status, "failed"),
            ),
          )
          .orderBy(desc(s.aiRun.createdAt))
          .limit(1)
      : [];
    const parts = [
      runs.failed > 0 && `${runs.failed} failed in the last day`,
      runs.stuck > 0 && `${runs.stuck} running for more than 30 minutes`,
    ].filter(Boolean);
    problems.push({
      key: "intelligence_failed",
      title: "Lictory Intelligence runs are failing",
      detail: `${parts.join(", ")}${
        latest?.error ? `; the latest error: ${latest.error}` : ""
      }. Check the AI provider under Lictory Intelligence settings, or ask whoever runs this server.`,
    });
  }

  // Hand-offs to the delivery tool that failed and were not retried.
  const handoffs = await db
    .select({
      projectId: s.workItem.projectId,
      failed: count(),
      latest: max(s.workItemExternalLink.lastError),
    })
    .from(s.workItemExternalLink)
    .innerJoin(
      s.workItem,
      and(
        eq(s.workItem.organizationId, s.workItemExternalLink.organizationId),
        eq(s.workItem.id, s.workItemExternalLink.workItemId),
      ),
    )
    .where(
      and(
        eq(s.workItemExternalLink.organizationId, organizationId),
        eq(s.workItemExternalLink.status, "failed"),
        lt(s.workItemExternalLink.updatedAt, ago(HOUR)),
      ),
    )
    .groupBy(s.workItem.projectId);
  for (const handoff of handoffs)
    problems.push({
      key: "handoff_failed",
      title:
        handoff.failed === 1
          ? "1 item's hand-off failed and was not retried"
          : `${handoff.failed} items' hand-offs failed and were not retried`,
      detail: `${handoff.latest ? `The latest error: ${handoff.latest} ` : ""}Fix the cause, then retry them on the project's Hand-off view.`,
      projectId: handoff.projectId,
    });

  // Instance-wide: zero-cache's replication slot, which keeps every
  // browser current. Only for instance administrators.
  const [viewer] = await db
    .select({
      instanceAdmin: s.user.instanceAdmin,
      deactivatedAt: s.user.deactivatedAt,
    })
    .from(s.user)
    .where(eq(s.user.id, userId));
  if (isInstanceAdmin(viewer)) {
    const replication = await replicationProblem(db);
    if (replication) problems.push(replication);
  }
  return { problems };
}

// The monitor's replication checks, where this database role may read
// them (a managed database may not expose the slot); null when healthy or
// unknown.
async function replicationProblem(
  db: Database,
): Promise<AdministratorProblem | null> {
  try {
    const slots = (await db.execute(sql`
      select slot_name as name, active, wal_status as "walStatus",
        pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::bigint as lag
      from pg_replication_slots
      where slot_type = 'logical' and database = current_database()`)) as unknown as {
      name: string;
      active: boolean;
      walStatus: string | null;
      lag: string | number | null;
    }[];
    const live = slots.filter((slot) => slot.active);
    const bad = slots.find(
      (slot) =>
        slot.walStatus === "lost" ||
        slot.walStatus === "unreserved" ||
        Number(slot.lag ?? 0) > SLOT_LAG_BYTES,
    );
    const detail = bad
      ? `Replication slot ${bad.name} is ${formatBytes(Number(bad.lag ?? 0))} behind (wal_status ${bad.walStatus ?? "unknown"}). Browsers may show old data until zero-cache catches up; docs/operations/deployment.md describes the recovery.`
      : !slots.length
        ? "No logical replication slot exists, so zero-cache is not replicating and browsers do not see changes. Check the zero-cache service (lictory status)."
        : !live.length
          ? "zero-cache's replication slot is not in use, so browsers do not see changes. Check the zero-cache service (lictory status)."
          : null;
    return detail
      ? {
          key: "replication",
          title: "Live updates are behind on this server",
          detail,
        }
      : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;
}
