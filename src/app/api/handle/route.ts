import { headers } from "next/headers";
import { z } from "zod";
import { trackServer } from "~/lib/analytics/server";

import { db } from "~/db";
import { auth } from "~/lib/auth";
import { checkHandle, claimHandle, suggestHandles } from "~/lib/handles-server";

export const dynamic = "force-dynamic";

async function currentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

const unauthorized = () =>
  Response.json(
    { error: { message: "Sign in to choose a handle." } },
    { status: 401 },
  );

// GET ?handle=x checks availability; without it, returns suggestions.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const handle = new URL(request.url).searchParams.get("handle");
  if (handle !== null)
    return Response.json(await checkHandle(db, user.id, handle.slice(0, 64)));
  return Response.json({
    current: user.handle ?? null,
    suggestions: await suggestHandles(db, user),
  });
}

const claimSchema = z.object({ handle: z.string().max(64) });

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return unauthorized();
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { message: "Enter a handle." } },
      { status: 400 },
    );
  const result = await claimHandle(db, user.id, parsed.data.handle);
  if (!result.available)
    return Response.json(
      { error: { message: result.reason } },
      { status: 409 },
    );
  trackServer(user.id, "onboarding_handle_completed", {}, request.headers);
  return Response.json({ handle: result.handle });
}
