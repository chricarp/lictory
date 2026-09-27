import { z } from "zod";

import { db } from "~/db";
import { auth } from "~/lib/auth";
import {
  createNotificationService,
  notificationActionSchema,
  notificationQuerySchema,
} from "~/notifications/service";
import { DomainError } from "~/sync/server/errors";

// Notifications are personal and online-only: they never enter the shared
// sync change log. Every request is scoped to the signed-in user.
export const dynamic = "force-dynamic";

const service = createNotificationService(db);
const requestSchema = z.union([
  z.object({ action: z.literal("list"), query: notificationQuerySchema }),
  z.object({ action: z.literal("unread") }),
  z.object({
    action: z.literal("preferences"),
    organizationId: z.string().min(1),
  }),
  z.object({
    action: z.literal("watching"),
    organizationId: z.string().min(1),
    workItemId: z.string().min(1),
  }),
  notificationActionSchema,
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin &&
    origin !== process.env.BETTER_AUTH_URL
  )
    return Response.json(
      { error: { category: "forbidden", message: "Cross-origin request." } },
      { status: 403 },
    );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      {
        error: {
          category: "unauthorized",
          message: "Sign in again to continue.",
        },
      },
      { status: 401 },
    );
  const user = session.user.id;
  try {
    const body = requestSchema.parse(await request.json());
    const result = await (() => {
      switch (body.action) {
        case "list":
          return service.list(user, body.query);
        case "unread":
          return service.unread(user).then((unread) => ({ unread }));
        case "preferences":
          return service.preferences(user, body.organizationId);
        case "watching":
          return service.watching(user, body.organizationId, body.workItemId);
        default:
          return service.act(user, body);
      }
    })();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError)
      return Response.json(
        { error: { category: error.category, message: error.message } },
        {
          status:
            error.category === "forbidden"
              ? 403
              : error.category === "unavailable"
                ? 404
                : error.category === "validation"
                  ? 422
                  : 409,
        },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: {
            category: "validation",
            message: "Invalid notification request.",
          },
        },
        { status: 400 },
      );
    console.error(
      JSON.stringify({ event: "notifications.error", error: String(error) }),
    );
    return Response.json(
      {
        error: {
          category: "unavailable",
          message: "Notifications could not be loaded. Try again shortly.",
        },
      },
      { status: 500 },
    );
  }
}
