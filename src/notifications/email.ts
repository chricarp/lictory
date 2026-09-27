import { and, eq, sql } from "drizzle-orm";
import { createElement } from "react";
import * as s from "../db/schema";
import { NotificationEmail } from "../emails/notification-email";
import { sendEmail, type OutgoingEmail } from "../lib/mailer";
import type { Database } from "../sync/server/service";
import { describeNotification, notificationHref } from "./format";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;

// Sends queued notification emails. Safe to run concurrently and repeatedly:
// rows are claimed with SKIP LOCKED plus a lease, the provider receives a
// stable idempotency key, and each outcome is recorded. Nothing is sent to
// someone who has since left the organization or archived the notification.
export async function dispatchNotificationEmails(
  db: Database,
  options: {
    limit?: number;
    now?: () => Date;
    send?: (email: OutgoingEmail) => Promise<void>;
    baseUrl?: string;
  } = {},
) {
  const now = options.now ?? (() => new Date());
  const send = options.send ?? sendEmail;
  const baseUrl = (
    options.baseUrl ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const at = now();
  const claimed = await db
    .update(s.notificationEmail)
    .set({
      leaseUntil: new Date(at.getTime() + LEASE_MS),
      attempts: sql`${s.notificationEmail.attempts} + 1`,
    })
    .where(
      sql`${s.notificationEmail.notificationId} in (
        select notification_id from notification_email
        where status = 'pending' and next_attempt_at <= ${at.toISOString()}::timestamp
          and (lease_until is null or lease_until < ${at.toISOString()}::timestamp)
        order by next_attempt_at
        limit ${options.limit ?? 50}
        for update skip locked)`,
    )
    .returning();
  const outcome = { sent: 0, skipped: 0, failed: 0, retrying: 0 };
  for (const row of claimed) {
    const settle = (values: Partial<typeof s.notificationEmail.$inferInsert>) =>
      db
        .update(s.notificationEmail)
        .set({ leaseUntil: null, ...values })
        .where(eq(s.notificationEmail.notificationId, row.notificationId));
    const [n] = await db
      .select({
        notification: s.notification,
        email: s.user.email,
        emailVerified: s.user.emailVerified,
        orgName: s.organization.name,
        orgSlug: s.organization.slug,
      })
      .from(s.notification)
      .innerJoin(s.user, eq(s.user.id, s.notification.userId))
      .innerJoin(
        s.organization,
        eq(s.organization.id, s.notification.organizationId),
      )
      .innerJoin(
        s.member,
        and(
          eq(s.member.organizationId, s.notification.organizationId),
          eq(s.member.userId, s.notification.userId),
        ),
      )
      .where(eq(s.notification.id, row.notificationId));
    if (!n || n.notification.archivedAt || !n.email) {
      await settle({
        status: "skipped",
        lastError: n ? null : "Recipient is no longer a member.",
      });
      outcome.skipped++;
      continue;
    }
    const actor = n.notification.actorId
      ? (
          await db
            .select({ name: s.user.name })
            .from(s.user)
            .where(eq(s.user.id, n.notification.actorId))
        )[0]?.name
      : null;
    const view = { kind: n.notification.kind, detail: n.notification.detail };
    const { headline, body } = describeNotification(view, actor ?? "Lictory");
    const title =
      typeof view.detail.title === "string" ? view.detail.title : null;
    const actionUrl = `${baseUrl}${notificationHref(n.orgSlug, {
      ...view,
      teamId: n.notification.teamId,
    })}`;
    const preferencesUrl = `${baseUrl}/app/${n.orgSlug}/inbox/settings`;
    try {
      await send({
        to: n.email,
        subject: title ? `${headline}: ${title}` : headline,
        text: [
          headline,
          title,
          body,
          "",
          `Open: ${actionUrl}`,
          "",
          `Notification settings: ${preferencesUrl}`,
        ]
          .filter((l) => l !== null)
          .join("\n"),
        react: createElement(NotificationEmail, {
          organizationName: n.orgName,
          headline,
          body,
          title,
          actionUrl,
          preferencesUrl,
        }),
        idempotencyKey: `lictory-notification-${row.notificationId}`,
      });
      await settle({ status: "sent", sentAt: now(), lastError: null });
      outcome.sent++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const final = row.attempts >= MAX_ATTEMPTS;
      await settle({
        status: final ? "failed" : "pending",
        lastError: message.slice(0, 1000),
        // 1, 2, 4, 8 minutes between attempts.
        nextAttemptAt: new Date(
          now().getTime() + 60_000 * 2 ** (row.attempts - 1),
        ),
      });
      if (final) outcome.failed++;
      else outcome.retrying++;
    }
  }
  return outcome;
}

// Immediate delivery after a commit, without waiting for the scheduled worker.
// Best-effort: anything left pending is picked up by the next job run.
let running: Promise<unknown> | null = null;
let again = false;
export function kickNotificationEmails(db: Database) {
  if (running) {
    again = true;
    return;
  }
  running = (async () => {
    do {
      again = false;
      await dispatchNotificationEmails(db).catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: "notifications.email.error",
            error: String(error),
          }),
        ),
      );
    } while (again);
  })().finally(() => {
    running = null;
  });
}
