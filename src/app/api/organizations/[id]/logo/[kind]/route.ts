import { db } from "~/db";
import { auth } from "~/lib/auth";
import { isLogoKind, MAX_LOGO_SIZE } from "~/branding/logo";
import { LogoError, readLogo } from "~/branding/server";
import { errorResponse, invokeForWeb } from "~/capabilities/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = RouteContext<"/api/organizations/[id]/logo/[kind]">;

async function target(request: Request, context: Context) {
  const { id, kind } = await context.params;
  if (!isLogoKind(kind)) throw new LogoError("Unknown logo kind.", 404);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return { organizationId: id, kind, userId: session.user.id };
}
class UnauthorizedError extends Error {}

function fail(error: unknown) {
  if (error instanceof UnauthorizedError)
    return Response.json(
      { error: "Sign in again to continue." },
      { status: 401 },
    );
  return errorResponse(error, "string");
}

export async function GET(request: Request, context: Context) {
  try {
    const t = await target(request, context);
    const logo = await readLogo(db, t.organizationId, t.userId, t.kind);
    const etag = `"${logo.sha256}"`;
    // URLs carry a content version, so a versioned request can be cached
    // privately for a long time; the unversioned one always revalidates.
    const versioned = new URL(request.url).searchParams.has("v");
    const headers = {
      "Content-Type": logo.mimeType,
      ETag: etag,
      "Cache-Control": versioned
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(logo.content), { headers });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const t = await target(request, context);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_SIZE)
      throw new LogoError(
        `Logos can be at most ${MAX_LOGO_SIZE / 1024} KB.`,
        413,
      );
    const bytes = Buffer.from(await request.arrayBuffer());
    return Response.json(
      await invokeForWeb(
        request,
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
    return fail(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const t = await target(request, context);
    await invokeForWeb(
      request,
      "removeOrganizationLogo",
      { organizationId: t.organizationId, kind: t.kind },
      { write: true },
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return fail(error);
  }
}
