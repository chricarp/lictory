import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { db } from "~/db";
import { user } from "~/db/auth-schema";
import { auth } from "~/lib/auth";
import { matchesAuthOrigin } from "~/lib/auth-base-url";
import { normalizeHandle, handleProblem } from "~/lib/handles";

const inputSchema = z.object({
  organizationId: z.string().min(1).max(160),
  recipient: z.string().trim().min(1).max(320),
});

export async function POST(request: Request) {
  // This wrapper calls server APIs: enforce the same origin before forwarding cookies.
  const origin = request.headers.get("origin");
  if (!matchesAuthOrigin(auth.options.baseURL, origin, request.url))
    return Response.json(
      { error: { message: "Invalid request origin." } },
      { status: 403 },
    );
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: { message: "Sign in to invite a teammate." } },
      { status: 401 },
    );
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { message: "Enter an email address or username." } },
      { status: 400 },
    );
  try {
    const { organizationId, recipient } = parsed.data;
    // Check permissions before resolving a platform-wide username.
    const permission = await auth.api.hasPermission({
      headers: request.headers,
      body: { organizationId, permissions: { invitation: ["create"] } },
    });
    if (!permission.success)
      return Response.json(
        {
          error: {
            message: "Only organization administrators can invite teammates.",
          },
        },
        { status: 403 },
      );
    let email = recipient.toLowerCase();
    if (!z.email().safeParse(email).success) {
      const handle = normalizeHandle(recipient);
      if (handleProblem(handle))
        return Response.json(
          { error: { message: "Enter a valid email address or username." } },
          { status: 400 },
        );
      const [account] = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.handle, handle))
        .limit(1);
      if (!account)
        return Response.json(
          {
            error: {
              message:
                "No account has that username. Invite them by email instead.",
            },
          },
          { status: 404 },
        );
      email = account.email;
    }
    const invitation = await auth.api.createInvitation({
      headers: request.headers,
      body: { organizationId, email, role: "member", resend: true },
    });
    // Do not disclose the email behind a username to the caller.
    return Response.json({ id: invitation.id });
  } catch (error) {
    if (error instanceof APIError)
      return Response.json(
        { error: { message: error.message } },
        { status: error.statusCode },
      );
    // Better Auth persists invitations before delivery. Retry resends the same invitation.
    return Response.json(
      {
        error: {
          message:
            "The invitation email could not be sent. Try again to resend it.",
        },
      },
      { status: 502 },
    );
  }
}
