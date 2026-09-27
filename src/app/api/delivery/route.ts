import { z } from "zod";

import { db } from "~/db";
import { kickNotificationEmails } from "~/notifications/email";
import { createDeliveryService } from "~/delivery/service";
import { DeliveryError } from "~/delivery/provider";
import { auth } from "~/lib/auth";
import { DomainError } from "~/sync/server/service";

// Delivery actions talk to external systems, so they are online-only and
// never go through the durable client mutation queue (which would also put
// API tokens in browser storage). Results reach other clients through the
// normal sync change log.

export const dynamic = "force-dynamic";
// Exports of large epics make several Jira calls per item.
export const maxDuration = 300;

const service = createDeliveryService(db);
const id = z.string().min(1).max(160);
const organizationId = id;
const exportScope = {
  organizationId,
  rootId: id.optional(),
  itemIds: z.array(id).max(500).optional(),
};

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect"),
    organizationId,
    name: z.string().max(120).default(""),
    baseUrl: z.string().min(1).max(300),
    email: z.string().trim().min(1).max(320),
    apiToken: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("disconnect"),
    organizationId,
    connectionId: id,
  }),
  z.object({
    action: z.literal("listProjects"),
    organizationId,
    connectionId: id,
    query: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal("describeProject"),
    organizationId,
    connectionId: id,
    projectKey: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("setTarget"),
    organizationId,
    connectionId: id,
    teamId: id.nullable(),
    projectKey: z.string().min(1).max(64),
    typeMapping: z.record(id, z.string().min(1).max(64)),
  }),
  z.object({
    action: z.literal("removeTarget"),
    organizationId,
    teamId: id.nullable(),
  }),
  z.object({ action: z.literal("preview"), ...exportScope }),
  z.object({
    action: z.literal("publish"),
    ...exportScope,
    overwriteItemIds: z.array(id).max(500).optional(),
  }),
  z.object({
    action: z.literal("publication"),
    organizationId,
    publicationId: id,
  }),
  z.object({
    action: z.literal("linkExisting"),
    organizationId,
    workItemId: id,
    externalKey: z.string().trim().min(1).max(64),
  }),
  z.object({
    action: z.literal("unlink"),
    organizationId,
    workItemId: id,
    connectionId: id,
  }),
]);

function failure(error: unknown, action?: string) {
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
  if (error instanceof DeliveryError)
    return Response.json(
      {
        error: {
          category: "delivery",
          kind: error.kind,
          message: error.message,
        },
      },
      { status: error.retryable ? 503 : 422 },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: { category: "validation", message: "Invalid delivery request." },
      },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: "delivery.error",
      action,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return Response.json(
    {
      error: {
        category: "server",
        message: "The delivery action failed. Retry shortly.",
      },
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin &&
    request.headers.get("origin") !== process.env.BETTER_AUTH_URL
  )
    return Response.json(
      { error: { category: "forbidden", message: "Invalid request origin." } },
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
  let action: string | undefined;
  try {
    const body = actionSchema.parse(await request.json());
    action = body.action;
    const result = await (() => {
      switch (body.action) {
        case "connect":
          return service.connect(user, body);
        case "disconnect":
          return service.disconnect(
            user,
            body.organizationId,
            body.connectionId,
          );
        case "listProjects":
          return service.listProjects(
            user,
            body.organizationId,
            body.connectionId,
            body.query,
          );
        case "describeProject":
          return service.describeProject(
            user,
            body.organizationId,
            body.connectionId,
            body.projectKey,
          );
        case "setTarget":
          return service.setTarget(user, body);
        case "removeTarget":
          return service.removeTarget(user, body.organizationId, body.teamId);
        case "preview":
          return service.preview(user, body);
        case "publish":
          return service.publish(user, body);
        case "publication":
          return service.publication(
            user,
            body.organizationId,
            body.publicationId,
          );
        case "linkExisting":
          return service.linkExisting(user, body);
        case "unlink":
          return service.unlink(user, body);
      }
    })();
    kickNotificationEmails(db);
    console.info(
      JSON.stringify({
        event: "delivery.action",
        action,
        organization: body.organizationId,
        user,
      }),
    );
    return Response.json(result ?? { ok: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error, action);
  }
}
