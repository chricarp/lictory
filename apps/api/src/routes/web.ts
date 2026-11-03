import { and, eq, gt, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { CapabilityError, httpStatus } from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import {
  errorResponse,
  invokeForWeb,
  webPrincipal,
} from "@lictory/core/capabilities/http";
import { db } from "@lictory/core/db";
import * as s from "@lictory/core/db/schema";
import { isLogoKind, MAX_LOGO_SIZE } from "@lictory/core/branding/logo";
import { LogoError, readLogo } from "@lictory/core/branding/server";
import { authorize } from "@lictory/core/domain/service";
import { heldOrganizations } from "@lictory/core/domain/two-factor-policy";
import { trackServer } from "@lictory/core/lib/analytics/server";
import { APPEARANCES, THEMES } from "@lictory/core/lib/appearance";
import { auth, authProviders } from "@lictory/core/lib/auth";
import { handleProblem, normalizeHandle } from "@lictory/core/lib/handles";
import {
  checkHandle,
  claimHandle,
  suggestHandles,
} from "@lictory/core/lib/handles-server";
import { MAX_CONTEXT_DOCUMENT_SIZE } from "@lictory/core/intelligence/shared";
import { PhotoError } from "@lictory/core/profile/image";
import { MAX_PROFILE_PHOTO_SIZE } from "@lictory/core/profile/photo";
import {
  readProfilePhoto,
  setProfilePhoto,
} from "@lictory/core/profile/server";
import { limit, MB, noStore } from "@lictory/api/middleware";

// Browser-facing routes: thin adapters from HTTP to capabilities and the
// domain services. Paths and response shapes are those of the former Next.js
// route handlers.

const json = (value: unknown, init?: ResponseInit) =>
  Response.json(value ?? { ok: true }, init);
const store = { headers: noStore };

// Better Auth's two-factor flag; the session user type does not carry plugin
// fields because the plugin list is assembled dynamically.
const twoFactorEnabled = (user: object) =>
  (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;

async function currentUser(request: Request) {
  return (
    (await auth.api.getSession({ headers: request.headers }))?.user ?? null
  );
}

// Dispatches `{ action, ...input }` bodies to named capabilities.
function actionRoute(
  actions: Record<string, string>,
  invalid: string,
  options: {
    shape?: "object" | "string";
    input?: (action: string, rest: Record<string, unknown>) => unknown;
  } = {},
) {
  return async (c: Context) => {
    const request = c.req.raw;
    try {
      const principal = await webPrincipal(request);
      const { action, ...rest } = ((await request.json().catch(() => null)) ??
        {}) as { action?: string } & Record<string, unknown>;
      const name = action && Object.hasOwn(actions, action) && actions[action];
      if (!name) throw new CapabilityError("validation", invalid);
      const input = options.input ? options.input(action, rest) : rest;
      return json(
        await invokeForWeb(request, name, input, { principal }),
        store,
      );
    } catch (error) {
      return errorResponse(error, options.shape);
    }
  };
}

export function webRoutes() {
  const app = new Hono();

  // Signed-in user summary for the SPA boot. Null when signed out.
  app.get("/api/session", async (c) => {
    const user = await currentUser(c.req.raw);
    // Organizations that will not open until this person turns on
    // two-factor authentication (enforced by the server either way).
    const twoFactorRequiredBy = user
      ? await heldOrganizations(db, user.id)
      : undefined;
    return c.json(
      {
        ...(twoFactorRequiredBy && { twoFactorRequiredBy }),
        user: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
              image: user.image ?? null,
              handle: user.handle ?? null,
              appearance: user.appearance,
              theme: user.theme,
              twoFactorEnabled: twoFactorEnabled(user),
            }
          : null,
        providers: authProviders,
      },
      200,
      noStore,
    );
  });

  // Account settings. Better Auth's list-sessions endpoint requires a fresh
  // session; this display-only summary reads directly while the sensitive
  // operations keep their freshness checks.
  app.get("/api/account", async (c) => {
    const user = await currentUser(c.req.raw);
    if (!user)
      return errorResponse(
        new CapabilityError("unauthorized", "Sign in again to continue."),
      );
    const [accounts, sessions] = await Promise.all([
      db
        .select({ id: s.account.id, providerId: s.account.providerId })
        .from(s.account)
        .where(eq(s.account.userId, user.id)),
      db
        .select({ id: s.session.id })
        .from(s.session)
        .where(
          and(
            eq(s.session.userId, user.id),
            gt(s.session.expiresAt, new Date()),
          ),
        ),
    ]);
    return c.json(
      {
        user: {
          name: user.name,
          image: user.image ?? null,
          email: user.email,
          emailVerified: user.emailVerified,
          handle: user.handle ?? "",
          twoFactorEnabled: twoFactorEnabled(user),
        },
        providers: authProviders,
        accounts,
        sessionCount: sessions.length,
      },
      200,
      noStore,
    );
  });

  // A personal display preference: scoped to the signed-in user only.
  const appearanceSchema = z
    .object({
      appearance: z.enum(APPEARANCES).optional(),
      theme: z.enum(THEMES).optional(),
    })
    .refine((b) => b.appearance !== undefined || b.theme !== undefined);
  app.post("/api/appearance", async (c) => {
    const user = await currentUser(c.req.raw);
    if (!user)
      return c.json(
        { error: { message: "Sign in to change your appearance." } },
        401,
      );
    const parsed = appearanceSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        {
          error: {
            message:
              "Choose light, dark or system, or one of the listed themes.",
          },
        },
        400,
      );
    const { appearance, theme } = parsed.data;
    await db
      .update(s.user)
      .set({ appearance, theme })
      .where(eq(s.user.id, user.id));
    trackServer(
      user.id,
      "appearance_changed",
      { ...(appearance && { appearance }), ...(theme && { theme }) },
      c.req.raw.headers,
    );
    return c.json({ appearance, theme });
  });

  // Any capability on the web surface, invoked as the signed-in user. Lookups
  // (members, epics, iteration reports, readiness history, the directory) go
  // through here.
  app.post("/api/capabilities/:name", async (c) => {
    try {
      const input: unknown = await c.req.json().catch(() => ({}));
      return json(
        await invokeForWeb(c.req.raw, c.req.param("name"), input, {
          write: true,
        }),
        store,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  // Delivery actions call external systems: online-only capabilities.
  app.post(
    "/api/delivery",
    actionRoute(
      {
        connect: "connectDelivery",
        disconnect: "disconnectDelivery",
        listProjects: "listDeliveryProjects",
        describeProject: "describeDeliveryProject",
        setTarget: "setDeliveryTarget",
        removeTarget: "removeDeliveryTarget",
        preview: "previewDeliveryExport",
        publish: "publishDelivery",
        publication: "getDeliveryPublication",
        linkExisting: "linkExternalItem",
        unlink: "unlinkExternalItem",
      },
      "Invalid delivery request.",
    ),
  );

  app.get("/api/files", async (c) => {
    try {
      return json(
        await invokeForWeb(c.req.raw, "listAttachments", {
          organizationId: c.req.query("organizationId") ?? "",
          workItemId: c.req.query("workItemId") ?? "",
        }),
        store,
      );
    } catch (error) {
      return errorResponse(error, "string");
    }
  });
  app.post(
    "/api/files",
    actionRoute(
      {
        start: "startAttachmentUpload",
        finish: "finishAttachmentUpload",
        remove: "removeAttachment",
      },
      "Invalid file request.",
      { shape: "string" },
    ),
  );
  app.get("/api/files/:id", async (c) => {
    try {
      const { url } = (await invokeForWeb(
        c.req.raw,
        "getAttachmentDownloadUrl",
        {
          fileId: c.req.param("id"),
          inline: c.req.query("download") !== "1",
        },
      )) as { url: string };
      return new Response(null, {
        status: 302,
        headers: { Location: url, "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      const e = toCapabilityError(error);
      return new Response(e.message, { status: httpStatus(e) });
    }
  });

  // GET ?handle=x checks availability; without it, returns suggestions.
  const signInForHandle = () =>
    Response.json(
      { error: { message: "Sign in to choose a handle." } },
      { status: 401 },
    );
  app.get("/api/handle", async (c) => {
    const user = await currentUser(c.req.raw);
    if (!user) return signInForHandle();
    const handle = c.req.query("handle");
    if (handle !== undefined)
      return c.json(await checkHandle(db, user.id, handle.slice(0, 64)));
    return c.json({
      current: user.handle ?? null,
      suggestions: await suggestHandles(db, user),
    });
  });
  app.post("/api/handle", async (c) => {
    const user = await currentUser(c.req.raw);
    if (!user) return signInForHandle();
    const parsed = z
      .object({ handle: z.string().max(64) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: { message: "Enter a handle." } }, 400);
    const result = await claimHandle(db, user.id, parsed.data.handle);
    if (!result.available)
      return c.json({ error: { message: result.reason } }, 409);
    trackServer(user.id, "onboarding_handle_completed", {}, c.req.raw.headers);
    return c.json({ handle: result.handle });
  });

  // Invitations resolve a username to its email without disclosing it.
  const invitationSchema = z.object({
    organizationId: z.string().min(1).max(160),
    recipient: z.string().trim().min(1).max(320),
  });
  app.post("/api/invitations", async (c) => {
    const request = c.req.raw;
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session)
      return c.json(
        { error: { message: "Sign in to invite a teammate." } },
        401,
      );
    const parsed = invitationSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        { error: { message: "Enter an email address or username." } },
        400,
      );
    try {
      const { organizationId, recipient } = parsed.data;
      // Check permissions before resolving a platform-wide username.
      const permission = await auth.api.hasPermission({
        headers: request.headers,
        body: { organizationId, permissions: { invitation: ["create"] } },
      });
      if (!permission.success)
        return c.json(
          {
            error: {
              message: "Only organization administrators can invite teammates.",
            },
          },
          403,
        );
      let email = recipient.toLowerCase();
      if (!z.email().safeParse(email).success) {
        const handle = normalizeHandle(recipient);
        if (handleProblem(handle))
          return c.json(
            { error: { message: "Enter a valid email address or username." } },
            400,
          );
        const [account] = await db
          .select({ email: s.user.email })
          .from(s.user)
          .where(eq(s.user.handle, handle))
          .limit(1);
        if (!account)
          return c.json(
            {
              error: {
                message:
                  "No account has that username. Invite them by email instead.",
              },
            },
            404,
          );
        email = account.email;
      }
      const invitation = await auth.api.createInvitation({
        headers: request.headers,
        body: { organizationId, email, role: "member", resend: true },
      });
      return c.json({ id: invitation.id });
    } catch (error) {
      if (error instanceof APIError)
        return Response.json(
          { error: { message: error.message } },
          { status: error.statusCode },
        );
      // Better Auth persists invitations before delivery; a retry resends.
      return c.json(
        {
          error: {
            message:
              "The invitation email could not be sent. Try again to resend it.",
          },
        },
        502,
      );
    }
  });

  // Personal notifications, scoped to the signed-in user.
  app.post(
    "/api/notifications",
    actionRoute(
      {
        list: "listNotifications",
        unread: "countUnreadNotifications",
        preferences: "getNotificationPreferences",
        watching: "getWatching",
        markRead: "markNotificationsRead",
        archive: "archiveNotifications",
        setPreferences: "setNotificationPreferences",
        resetScope: "resetNotificationPreferences",
        watch: "watchWorkItem",
      },
      "Invalid notification request.",
      { input: (action, rest) => (action === "list" ? rest.query : rest) },
    ),
  );

  // What steers Lictory Intelligence: readable by every member.
  app.get("/api/organizations/:id/intelligence-context", async (c) => {
    try {
      return json(
        await invokeForWeb(c.req.raw, "listIntelligenceContext", {
          organizationId: c.req.param("id"),
        }),
        store,
      );
    } catch (error) {
      return errorResponse(error, "string");
    }
  });
  const field = (form: FormData, name: string) => {
    const value = form.get(name);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  app.post(
    "/api/organizations/:id/intelligence-context",
    // Multipart framing adds a little to the document itself.
    limit(
      MAX_CONTEXT_DOCUMENT_SIZE + 64 * 1024,
      `Documents can be at most ${MAX_CONTEXT_DOCUMENT_SIZE / MB} MB.`,
      "string",
    ),
    async (c) => {
      try {
        const request = c.req.raw;
        const organizationId = c.req.param("id");
        const principal = await webPrincipal(request);
        const form = await request.formData();
        const action = z
          .enum(["create", "revise", "archive", "restore"])
          .parse(field(form, "action"));
        const run = (name: string, input: unknown) =>
          invokeForWeb(request, name, input, { principal });
        if (action === "archive" || action === "restore")
          return json(
            await run("archiveIntelligenceContext", {
              organizationId,
              entryId: field(form, "entryId"),
              archived: action === "archive",
            }),
          );
        const file = form.get("file");
        const body = {
          organizationId,
          title: field(form, "title") ?? "",
          content: field(form, "content"),
          file:
            file instanceof File
              ? {
                  filename: file.name,
                  contentBase64: Buffer.from(await file.arrayBuffer()).toString(
                    "base64",
                  ),
                }
              : undefined,
        };
        if (action === "create")
          return json(
            await run("createIntelligenceContext", {
              ...body,
              target: {
                scope: field(form, "scope"),
                projectId: field(form, "projectId"),
                teamId: field(form, "teamId"),
              },
            }),
          );
        return json(
          await run("reviseIntelligenceContext", {
            ...body,
            entryId: field(form, "entryId"),
          }),
        );
      } catch (error) {
        return errorResponse(error, "string");
      }
    },
  );
  app.get("/api/organizations/:id/intelligence-context/:entry", async (c) => {
    try {
      return json(
        await invokeForWeb(c.req.raw, "getIntelligenceContextHistory", {
          organizationId: c.req.param("id"),
          entryId: c.req.param("entry"),
        }),
        store,
      );
    } catch (error) {
      return errorResponse(error, "string");
    }
  });

  // Organization branding.
  const logoTarget = async (request: Request, id: string, kind: string) => {
    if (!isLogoKind(kind)) throw new LogoError("Unknown logo kind.", 404);
    const user = await currentUser(request);
    if (!user)
      throw new CapabilityError("unauthorized", "Sign in again to continue.");
    return { organizationId: id, kind, userId: user.id };
  };
  app.get("/api/organizations/:id/logo/:kind", async (c) => {
    try {
      const t = await logoTarget(
        c.req.raw,
        c.req.param("id"),
        c.req.param("kind"),
      );
      const logo = await readLogo(db, t.organizationId, t.userId, t.kind);
      const etag = `"${logo.sha256}"`;
      // Versioned URLs can be cached privately for a long time.
      const headers = {
        "Content-Type": logo.mimeType,
        ETag: etag,
        "Cache-Control":
          c.req.query("v") !== undefined
            ? "private, max-age=31536000, immutable"
            : "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      };
      if (c.req.header("if-none-match") === etag)
        return new Response(null, { status: 304, headers });
      return new Response(new Uint8Array(logo.content), { headers });
    } catch (error) {
      return errorResponse(error, "string");
    }
  });
  app.put(
    "/api/organizations/:id/logo/:kind",
    limit(
      MAX_LOGO_SIZE,
      `Logos can be at most ${MAX_LOGO_SIZE / 1024} KB.`,
      "string",
    ),
    async (c) => {
      try {
        const t = await logoTarget(
          c.req.raw,
          c.req.param("id"),
          c.req.param("kind"),
        );
        const bytes = Buffer.from(await c.req.arrayBuffer());
        return json(
          await invokeForWeb(
            c.req.raw,
            "setOrganizationLogo",
            {
              organizationId: t.organizationId,
              kind: t.kind,
              contentBase64: bytes.toString("base64"),
            },
            { write: true },
          ),
        );
      } catch (error) {
        return errorResponse(error, "string");
      }
    },
  );
  app.delete("/api/organizations/:id/logo/:kind", async (c) => {
    try {
      const t = await logoTarget(
        c.req.raw,
        c.req.param("id"),
        c.req.param("kind"),
      );
      await invokeForWeb(
        c.req.raw,
        "removeOrganizationLogo",
        { organizationId: t.organizationId, kind: t.kind },
        { write: true },
      );
      return new Response(null, { status: 204 });
    } catch (error) {
      return errorResponse(error, "string");
    }
  });

  // Presence heartbeat: membership-checked, broadcast through NOTIFY to
  // every API process's event streams. Nothing is stored.
  const presenceSchema = z.object({
    organizationId: z.string().min(1),
    workItemId: z.string().min(1).nullable(),
  });
  app.post("/api/presence", async (c) => {
    const user = await currentUser(c.req.raw);
    if (!user) return new Response(null, { status: 401 });
    const parsed = presenceSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return new Response(null, { status: 400 });
    try {
      await authorize(db, user.id, parsed.data.organizationId);
    } catch {
      return new Response(null, { status: 403 });
    }
    const payload = JSON.stringify({
      organizationId: parsed.data.organizationId,
      workItemId: parsed.data.workItemId,
      userId: user.id,
      at: Date.now(),
    });
    await db.execute(sql`select pg_notify('lictory_presence', ${payload})`);
    return new Response(null, { status: 204 });
  });

  // Profile photos.
  const photoFailure = (error: unknown) =>
    error instanceof PhotoError
      ? Response.json(
          { error: error.message },
          { status: error.status, headers: noStore },
        )
      : errorResponse(error, "string");
  app.put("/api/profile/photo", async (c) => {
    try {
      const { userId } = await webPrincipal(c.req.raw);
      if (Number(c.req.header("content-length")) > MAX_PROFILE_PHOTO_SIZE)
        throw new PhotoError("Choose a photo smaller than 4 MB.", 413);
      // Bound the actual stream too: Content-Length is not authoritative.
      const reader = c.req.raw.body?.getReader();
      if (!reader) throw new PhotoError("Choose a photo to upload.", 400);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PROFILE_PHOTO_SIZE) {
            await reader.cancel();
            throw new PhotoError("Choose a photo smaller than 4 MB.", 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return json(
        await setProfilePhoto(db, userId, Buffer.concat(chunks)),
        store,
      );
    } catch (error) {
      return photoFailure(error);
    }
  });
  app.delete("/api/profile/photo", async (c) => {
    try {
      const { userId } = await webPrincipal(c.req.raw);
      return json(await setProfilePhoto(db, userId, null), store);
    } catch (error) {
      return photoFailure(error);
    }
  });
  app.get("/api/users/:id/photo", async (c) => {
    try {
      const { userId } = await webPrincipal(c.req.raw);
      const photo = await readProfilePhoto(db, userId, c.req.param("id"));
      const etag = `"${photo.sha256}"`;
      const headers = {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-cache",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      };
      if (c.req.header("if-none-match") === etag)
        return new Response(null, { status: 304, headers });
      return new Response(new Uint8Array(photo.content), { headers });
    } catch (error) {
      return photoFailure(error);
    }
  });

  // Readiness previews carry a whole draft Definition of Ready.
  app.post("/api/readiness", async (c) => {
    try {
      return json(
        await invokeForWeb(
          c.req.raw,
          "previewReadinessChecks",
          await c.req.json().catch(() => null),
        ),
        store,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  return app;
}

export const DEFAULT_BODY_LIMIT = 10 * MB;
