import { z } from "zod";
import {
  createNotificationService,
  notificationActionSchema,
  notificationQuerySchema,
  type NotificationAction,
} from "@lictory/core/notifications/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";

// Notifications are personal: every call is scoped to the principal and,
// through membership, to organizations they still belong to.

const service = (ctx: CapabilityContext) => createNotificationService(ctx.db);

const listNotifications = defineCapability({
  name: "listNotifications",
  title: "List notifications",
  description:
    "Your inbox: review requests, blocking comments, mentions, approvals invalidated and similar events, newest first. Page with `before` set to the last item's `${createdAt}|${id}`.",
  kind: "query",
  surfaces: everywhere,
  input: notificationQuerySchema,
  run: (ctx, query) => service(ctx).list(ctx.principal.userId, query),
});

const countUnreadNotifications = defineCapability({
  name: "countUnreadNotifications",
  title: "Count unread notifications",
  description: "Unread notification counts per organization.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({}),
  run: async (ctx) => ({
    unread: await service(ctx).unread(ctx.principal.userId),
  }),
});

const getNotificationPreferences = defineCapability({
  name: "getNotificationPreferences",
  title: "Get notification preferences",
  description:
    "Your in-app and email notification rules per kind and scope in an organization.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    service(ctx).preferences(ctx.principal.userId, input.organizationId),
});

const getWatching = defineCapability({
  name: "getWatching",
  title: "Get watch state",
  description: "Whether you watch a work item and why.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, workItemId: id }),
  run: (ctx, input) =>
    service(ctx).watching(
      ctx.principal.userId,
      input.organizationId,
      input.workItemId,
    ),
});

type ActionName = NotificationAction["action"];
const actionDocs: Record<
  ActionName,
  { name: string; title: string; description: string; event: string }
> = {
  markRead: {
    name: "markNotificationsRead",
    title: "Mark notifications read",
    description:
      "Mark notifications read or unread. Without ids, every unread notification (optionally in one organization).",
    event: "notification_read_changed",
  },
  archive: {
    name: "archiveNotifications",
    title: "Archive notifications",
    description: "Archive or unarchive notifications.",
    event: "notification_archive_changed",
  },
  setPreferences: {
    name: "setNotificationPreferences",
    title: "Set notification preferences",
    description:
      "Set in-app/email delivery per notification kind for an organization, project or team scope; `reset: true` removes a rule.",
    event: "notification_preferences_updated",
  },
  resetScope: {
    name: "resetNotificationPreferences",
    title: "Reset notification preferences",
    description: "Remove every rule of one scope so broader defaults apply.",
    event: "notification_preferences_reset",
  },
  watch: {
    name: "watchWorkItem",
    title: "Watch work item",
    description:
      "Watch (true) or unwatch (false) a work item; null returns to following involvement.",
    event: "work_item_watch_changed",
  },
};

const actionCapabilities = notificationActionSchema.options.map((option) => {
  const action = option.shape.action.value;
  const doc = actionDocs[action];
  return defineCapability({
    name: doc.name,
    title: doc.title,
    description: doc.description,
    kind: "command",
    surfaces: everywhere,
    idempotent: true,
    input: (option as z.ZodObject).omit({ action: true }),
    async run(ctx, input) {
      const body = { action, ...input } as NotificationAction;
      const result = await service(ctx).act(ctx.principal.userId, body);
      ctx.effects.track(doc.event, {
        ...(action !== "markRead" &&
        "organizationId" in body &&
        body.organizationId
          ? { organization_id: body.organizationId }
          : {}),
        ...("workItemId" in body ? { work_item_id: body.workItemId } : {}),
        ...("read" in body && body.read !== undefined
          ? { read: body.read }
          : {}),
        ...("archived" in body && body.archived !== undefined
          ? { archived: body.archived }
          : {}),
        ...("watching" in body ? { watching: body.watching } : {}),
        ...("scope" in body ? { scope: body.scope } : {}),
        ...("ids" in body && body.ids
          ? { notification_count: body.ids.length }
          : {}),
      });
      return result ?? { ok: true };
    },
  });
});

export const notificationCapabilities = [
  listNotifications,
  countUnreadNotifications,
  getNotificationPreferences,
  getWatching,
  ...actionCapabilities,
] as AnyCapability[];
