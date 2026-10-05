import { z } from "zod";
import { auth } from "~/lib/auth";
import { ConversionError } from "./convert";
import { ContextError } from "./server";

export class UnauthorizedError extends Error {}

export async function sessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin &&
    origin !== process.env.BETTER_AUTH_URL
  )
    throw new ContextError("Cross-origin request.", 403);
}

export function contextFailure(error: unknown) {
  if (error instanceof UnauthorizedError)
    return Response.json(
      { error: "Sign in again to continue." },
      { status: 401 },
    );
  if (error instanceof ContextError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ConversionError)
    return Response.json({ error: error.message }, { status: 422 });
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Invalid context request." },
      { status: 400 },
    );
  console.error(
    JSON.stringify({
      event: "intelligence_context.error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return Response.json(
    { error: "Lictory Intelligence Context could not be saved. Try again." },
    { status: 500 },
  );
}
