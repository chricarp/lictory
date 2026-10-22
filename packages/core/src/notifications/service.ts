import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import type { Database } from "@lictory/core/domain/service";
import { isNotificationKind, notificationKindList } from "@lictory/core/notifications/catalog";

const kind = z
  .string()
  .refine(isNotificationKind, "Unknown notification kind.");

export const notificationQuerySchema = z.object({
  organizationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  kinds: z.array(kind).optional(),
  status: z.enum(["unread", "all", "archived"]).default("all"),
  // Opaque: `${createdAt ISO}|${id}` of the last row seen.
  before: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const notificationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("markRead"),
    ids: z.array(z.string().min(1)).max(500).optional(),
    // Without ids: every unread notification, optionally in one organization.
    organizationId: z.string().min(1).optional(),
    read: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("archive"),
    ids: z.array(z.string().min(1)).min(1).max(500),
    archived: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("setPreferences"),
    organizationId: z.string().min(1),
    scope: z.enum(["organization", "project", "team"]),
    scopeId: z.string().min(1),
    rules: z
      .array(
        z.union([
          z.object({ kind, inApp: z.boolean(), email: z.boolean() }),
          // Removes the rule so the broader scope (or default) applies again.
          z.object({ kind, reset: z.literal(true) }),
        ]),
      )
      .min(1)
      .max(notificationKindList.length),
  }),
  z.object({
    action: z.literal("resetScope"),
    organizationId: z.string().min(1),
    scope: z.enum(["organization", "project", "team"]),
    scopeId: z.string().min(1),
  }),
  z.object({
    action: z.literal("watch"),
    organizationId: z.string().min(1),
    workItemId: z.string().min(1),
    // null clears the explicit choice and falls back to involvement.
    watching: z.boolean().nullable(),
  }),
]);
export type NotificationQuery = z.input<typeof notificationQuerySchema>;
export type NotificationAction = z.input<typeof notificationActionSchema>;

export type NotificationItem = {
  id: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  kind: string;
  actorId: string | null;
  actorName: string | null;
  projectId: string | null;
  teamId: string | null;
  workItemId: string | null;
  detail: Record<string, unknown>;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

// Every read and write is scoped to the authenticated user and, through the
// member join, to organizations they still belong to.
export function createNotificationService(db: Database) {
  async function requireMember(userId: string, organizationId: string) {
    const [m] = await db
      .select({ id: s.member.id })
      .from(s.member)
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          eq(s.member.userId, userId),
        ),
      );
    if (!m)
      throw new DomainError(
        "forbidden",
        "Organization access has been removed.",
      );
  }
  const memberOf = and(
    eq(s.member.organizationId, s.notification.organizationId),
    eq(s.member.userId, s.notification.userId),
  );
  return {
    async list(userId: string, input: NotificationQuery) {
      const q = notificationQuerySchema.parse(input);
      const where: (SQL | undefined)[] = [eq(s.notification.userId, userId)];
      if (q.organizationId)
        where.push(eq(s.notification.organizationId, q.organizationId));
      if (q.projectId) where.push(eq(s.notification.projectId, q.projectId));
      if (q.teamId) where.push(eq(s.notification.teamId, q.teamId));
      if (q.kinds?.length) where.push(inArray(s.notification.kind, q.kinds));
      if (q.status === "archived")
        where.push(sql`${s.notification.archivedAt} is not null`);
      else where.push(isNull(s.notification.archivedAt));
      if (q.status === "unread") where.push(isNull(s.notification.readAt));
      if (q.before) {
        const [at, id] = q.before.split("|");
        const date = new Date(at ?? "");
        if (id && !Number.isNaN(date.getTime()))
          where.push(
            or(
              lt(s.notification.createdAt, date),
              and(
                eq(s.notification.createdAt, date),
                lt(s.notification.id, id),
              ),
            ),
          );
      }
      const rows = await db
        .select({
          n: s.notification,
          orgSlug: s.organization.slug,
          orgName: s.organization.name,
          actorName: s.user.name,
        })
        .from(s.notification)
        .innerJoin(s.member, memberOf)
        .innerJoin(
          s.organization,
          eq(s.organization.id, s.notification.organizationId),
        )
        .leftJoin(s.user, eq(s.user.id, s.notification.actorId))
        .where(and(...where))
        .orderBy(desc(s.notification.createdAt), desc(s.notification.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const items: NotificationItem[] = page.map(
        ({ n, orgSlug, orgName, actorName }) => ({
          id: n.id,
          organizationId: n.organizationId,
          organizationSlug: orgSlug,
          organizationName: orgName,
          kind: n.kind,
          actorId: n.actorId,
          actorName,
          projectId: n.projectId,
          teamId: n.teamId,
          workItemId: n.workItemId,
          detail: n.detail,
          readAt: n.readAt?.toISOString() ?? null,
          archivedAt: n.archivedAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        }),
      );
      const last = page.at(-1);
      return {
        items,
        next:
          rows.length > q.limit && last
            ? `${last.n.createdAt.toISOString()}|${last.n.id}`
            : null,
        unread: await this.unread(userId),
      };
    },
    // Unread counts per organization, for badges.
    async unread(userId: string) {
      const rows = await db
        .select({
          organizationId: s.notification.organizationId,
          count: sql<number>`count(*)::int`,
        })
        .from(s.notification)
        .innerJoin(s.member, memberOf)
        .where(
          and(
            eq(s.notification.userId, userId),
            isNull(s.notification.readAt),
            isNull(s.notification.archivedAt),
          ),
        )
        .groupBy(s.notification.organizationId);
      return Object.fromEntries(rows.map((r) => [r.organizationId, r.count]));
    },
    async preferences(userId: string, organizationId: string) {
      await requireMember(userId, organizationId);
      const rules = await db
        .select({
          scope: s.notificationPreference.scope,
          scopeId: s.notificationPreference.scopeId,
          kind: s.notificationPreference.kind,
          inApp: s.notificationPreference.inApp,
          email: s.notificationPreference.email,
        })
        .from(s.notificationPreference)
        .where(
          and(
            eq(s.notificationPreference.userId, userId),
            eq(s.notificationPreference.organizationId, organizationId),
          ),
        );
      return { rules: rules.filter((r) => isNotificationKind(r.kind)) };
    },
    async watching(userId: string, organizationId: string, workItemId: string) {
      await requireMember(userId, organizationId);
      const [row] = await db
        .select({ watching: s.workItemWatcher.watching })
        .from(s.workItemWatcher)
        .where(
          and(
            eq(s.workItemWatcher.organizationId, organizationId),
            eq(s.workItemWatcher.workItemId, workItemId),
            eq(s.workItemWatcher.userId, userId),
          ),
        );
      return { watching: row?.watching ?? null };
    },
    async act(userId: string, input: NotificationAction) {
      const a = notificationActionSchema.parse(input);
      switch (a.action) {
        case "markRead": {
          const where = [eq(s.notification.userId, userId)];
          if (a.ids) where.push(inArray(s.notification.id, a.ids));
          else where.push(isNull(s.notification.readAt));
          if (a.organizationId)
            where.push(eq(s.notification.organizationId, a.organizationId));
          await db
            .update(s.notification)
            .set({ readAt: a.read ? new Date() : null })
            .where(and(...where));
          return { ok: true };
        }
        case "archive":
          await db
            .update(s.notification)
            .set(
              a.archived
                ? {
                    archivedAt: new Date(),
                    readAt: sql`coalesce(${s.notification.readAt}, now())`,
                  }
                : { archivedAt: null },
            )
            .where(
              and(
                eq(s.notification.userId, userId),
                inArray(s.notification.id, a.ids),
              ),
            );
          return { ok: true };
        case "setPreferences":
        case "resetScope": {
          await requireMember(userId, a.organizationId);
          await requireScope(db, a.organizationId, a.scope, a.scopeId);
          const key = and(
            eq(s.notificationPreference.userId, userId),
            eq(s.notificationPreference.organizationId, a.organizationId),
            eq(s.notificationPreference.scope, a.scope),
            eq(s.notificationPreference.scopeId, a.scopeId),
          );
          await db.transaction(async (tx) => {
            if (a.action === "resetScope") {
              await tx.delete(s.notificationPreference).where(key);
              return;
            }
            for (const rule of a.rules) {
              if ("reset" in rule) {
                await tx
                  .delete(s.notificationPreference)
                  .where(
                    and(key, eq(s.notificationPreference.kind, rule.kind)),
                  );
                continue;
              }
              await tx
                .insert(s.notificationPreference)
                .values({
                  userId,
                  organizationId: a.organizationId,
                  scope: a.scope,
                  scopeId: a.scopeId,
                  kind: rule.kind,
                  inApp: rule.inApp,
                  email: rule.inApp && rule.email,
                })
                .onConflictDoUpdate({
                  target: [
                    s.notificationPreference.userId,
                    s.notificationPreference.organizationId,
                    s.notificationPreference.scope,
                    s.notificationPreference.scopeId,
                    s.notificationPreference.kind,
                  ],
                  set: { inApp: rule.inApp, email: rule.inApp && rule.email },
                });
            }
          });
          return this.preferences(userId, a.organizationId);
        }
        case "watch": {
          await requireMember(userId, a.organizationId);
          const [item] = await db
            .select({ id: s.workItem.id })
            .from(s.workItem)
            .where(
              and(
                eq(s.workItem.organizationId, a.organizationId),
                eq(s.workItem.id, a.workItemId),
              ),
            );
          if (!item)
            throw new DomainError("unavailable", "This item is unavailable.");
          const key = and(
            eq(s.workItemWatcher.organizationId, a.organizationId),
            eq(s.workItemWatcher.workItemId, a.workItemId),
            eq(s.workItemWatcher.userId, userId),
          );
          if (a.watching === null)
            await db.delete(s.workItemWatcher).where(key);
          else
            await db
              .insert(s.workItemWatcher)
              .values({
                organizationId: a.organizationId,
                workItemId: a.workItemId,
                userId,
                watching: a.watching,
              })
              .onConflictDoUpdate({
                target: [
                  s.workItemWatcher.organizationId,
                  s.workItemWatcher.workItemId,
                  s.workItemWatcher.userId,
                ],
                set: { watching: a.watching },
              });
          return { watching: a.watching };
        }
      }
    },
  };
}

async function requireScope(
  db: Database,
  organizationId: string,
  scope: "organization" | "project" | "team",
  scopeId: string,
) {
  const exists =
    scope === "organization"
      ? scopeId === organizationId
      : scope === "project"
        ? (
            await db
              .select({ id: s.project.id })
              .from(s.project)
              .where(
                and(
                  eq(s.project.organizationId, organizationId),
                  eq(s.project.id, scopeId),
                ),
              )
          ).length > 0
        : (
            await db
              .select({ id: s.team.id })
              .from(s.team)
              .where(
                and(
                  eq(s.team.organizationId, organizationId),
                  eq(s.team.id, scopeId),
                ),
              )
          ).length > 0;
  if (!exists)
    throw new DomainError("unavailable", `That ${scope} is unavailable.`);
}
