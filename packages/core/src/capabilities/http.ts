import { auth } from "@lictory/core/lib/auth";
import { matchesPlatformOrigin } from "@lictory/core/lib/auth-base-url";
import {
  CapabilityError,
  httpStatus,
  type Principal,
} from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { invoke } from "@lictory/core/capabilities/registry";
import { serverContext } from "@lictory/core/capabilities/server";

// Helpers for browser-facing routes: the signed-in session is the principal,
// and cookie-authenticated writes must be same-origin.

// Cookie-authenticated writes must come from the platform's exact origin.
export function requireSameOrigin(request: Request) {
  if (!matchesPlatformOrigin(request.headers.get("origin")))
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
