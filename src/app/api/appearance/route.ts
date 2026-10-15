import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { trackServer } from "~/lib/analytics/server";

import { db } from "~/db";
import { user } from "~/db/auth-schema";
import { APPEARANCES, THEMES } from "~/lib/appearance";
import { auth } from "~/lib/auth";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    appearance: z.enum(APPEARANCES).optional(),
    theme: z.enum(THEMES).optional(),
  })
  .refine((body) => body.appearance !== undefined || body.theme !== undefined);

// A personal display preference: scoped to the signed-in user only, never to
// an organization, so it needs no workspace authorization or change log.
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return Response.json(
      { error: { message: "Sign in to change your appearance." } },
      { status: 401 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        error: {
          message: "Choose light, dark or system, or one of the listed themes.",
        },
      },
      { status: 400 },
    );
  const { appearance, theme } = parsed.data;
  await db
    .update(user)
    .set({ appearance, theme })
    .where(eq(user.id, session.user.id));
  trackServer(
    session.user.id,
    "appearance_changed",
    { ...(appearance && { appearance }), ...(theme && { theme }) },
    request.headers,
  );
  return Response.json({ appearance, theme });
}
