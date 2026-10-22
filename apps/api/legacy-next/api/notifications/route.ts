import {
  errorResponse,
  invokeForWeb,
  noStore,
  requireSameOrigin,
  webPrincipal,
} from "@lictory/core/capabilities/http";
import { CapabilityError } from "@lictory/core/capabilities/core";

// Notifications are personal and online-only: they never enter the shared
// sync change log. Every request is scoped to the signed-in user.
export const dynamic = "force-dynamic";

const actions: Record<string, string> = {
  list: "listNotifications",
  unread: "countUnreadNotifications",
  preferences: "getNotificationPreferences",
  watching: "getWatching",
  markRead: "markNotificationsRead",
  archive: "archiveNotifications",
  setPreferences: "setNotificationPreferences",
  resetScope: "resetNotificationPreferences",
  watch: "watchWorkItem",
};

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const principal = await webPrincipal(request);
    const { action, ...rest } = ((await request.json().catch(() => null)) ??
      {}) as { action?: string; query?: unknown };
    const name = action && Object.hasOwn(actions, action) && actions[action];
    if (!name)
      throw new CapabilityError("validation", "Invalid notification request.");
    const input = action === "list" ? rest.query : rest;
    return Response.json(
      await invokeForWeb(request, name, input, { principal }),
      noStore,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
