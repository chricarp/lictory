import { db } from "~/db";
import { auth } from "~/lib/auth";
import { isLogoKind, MAX_LOGO_SIZE } from "~/branding/logo";
import { LogoError, readLogo, removeLogo, setLogo } from "~/branding/server";

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

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin &&
    origin !== process.env.BETTER_AUTH_URL
  )
    throw new LogoError("Cross-origin request.", 403);
}

function fail(error: unknown) {
  if (error instanceof UnauthorizedError)
    return Response.json(
      { error: "Sign in again to continue." },
      { status: 401 },
    );
  if (error instanceof LogoError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("organization.logo.error", error);
  return Response.json(
    { error: "The logo could not be saved." },
    { status: 500 },
  );
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
    sameOrigin(request);
    const t = await target(request, context);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_SIZE)
      throw new LogoError(
        `Logos can be at most ${MAX_LOGO_SIZE / 1024} KB.`,
        413,
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await setLogo(db, t.organizationId, t.userId, t.kind, bytes);
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const t = await target(request, context);
    await removeLogo(db, t.organizationId, t.userId, t.kind);
    return new Response(null, { status: 204 });
  } catch (error) {
    return fail(error);
  }
}
