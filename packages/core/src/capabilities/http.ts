
import { auth } from "@lictory/core/lib/auth";
import { CapabilityError, httpStatus, type Principal } from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { invoke } from "@lictory/core/capabilities/registry";
import { serverContext } from "@lictory/core/capabilities/server";

// Helpers for browser-facing routes: the signed-in session is the principal,
// and cookie-authenticated writes must be same-origin.

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin &&
    origin !== process.env.BETTER_AUTH_URL
  )
    throw new CapabilityError("forbidden", "Invalid request origin.");
}

export async function webPrincipal(
  request: Request,
  message = "Sign in again to continue.",
): Promise<Principal> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new CapabilityError("unauthorized", message);
  return { userId: session.user.id, surface: "web" };
}

// Invokes a capability for the signed-in browser user.
export async function invokeForWeb(
  request: Request,
  name: string,
  input: unknown,
  options: { write?: boolean; principal?: Principal } = {},
) {
  if (options.write) requireSameOrigin(request);
  const principal = options.principal ?? (await webPrincipal(request));
  return invoke(serverContext(principal, request.headers), name, input);
}

export function errorResponse(
  error: unknown,
  shape: "object" | "string" = "object",
) {
  const e = toCapabilityError(error);
  return Response.json(
    shape === "string" ? { error: e.message } : { error: e.toJSON() },
    { status: httpStatus(e) },
  );
}

export const noStore = { headers: { "Cache-Control": "no-store" } };
