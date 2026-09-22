import { z } from "zod";
import { db } from "~/db";
import { auth } from "~/lib/auth";
import {
  createSyncService,
  directory,
  DomainError,
  searchEpics,
  searchMembers,
} from "~/sync/server/service";
import {
  checkpointSchema,
  epicSearchSchema,
  memberSearchSchema,
  mutationSchema,
  pageSchema,
  scopeSchema,
} from "~/sync/shared/protocol";

const service = createSyncService(db);
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  if (error instanceof DomainError)
    return Response.json(
      {
        error: {
          category: error.category,
          message: error.message,
          currentRevisionId: error.currentRevisionId,
        },
      },
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
  if (error instanceof z.ZodError)
    return Response.json(
      { error: { category: "validation", message: "Invalid sync request." } },
      { status: 400 },
    );
  console.error(JSON.stringify({ event: "sync.error", category: "server" }));
  return Response.json(
    {
      error: {
        category: "server",
        message: "The change could not be saved. Retry shortly.",
      },
    },
    { status: 500 },
  );
}
export async function GET(request: Request) {
  const start = Date.now();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      {
        error: {
          category: "unauthorized",
          message: "Sign in again to synchronize.",
        },
      },
      { status: 401 },
    );
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (params.directory === "1")
      return Response.json(
        await directory(db, session.user.id, params.organizationId),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (params.members === "1") {
      const query = memberSearchSchema.parse(params);
      return Response.json(
        await searchMembers(
          db,
          session.user.id,
          query.organizationId,
          query.q,
          query.offset,
          query.limit,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (params.epics === "1") {
      const query = epicSearchSchema.parse(params);
      return Response.json(
        await searchEpics(
          db,
          session.user.id,
          query.organizationId,
          query.projectId,
          query.q,
          query.offset,
          query.limit,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const scope = scopeSchema.parse(params);
    const cursor =
      params.cursor === undefined
        ? undefined
        : checkpointSchema.parse(params.cursor);
    const page = pageSchema.parse(
      await service.read(session.user.id, scope, cursor),
    );
    console.info(
      JSON.stringify({
        event: "sync.read",
        organization: scope.organizationId,
        user: session.user.id,
        checkpoint: page.nextCursor,
        changes: page.changes.length,
        duration: Date.now() - start,
      }),
    );
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  // Cookie-authenticated writes must be same-origin, including requests outside React.
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
          message: "Sign in again to save changes.",
        },
      },
      { status: 401 },
    );
  const start = Date.now();
  try {
    const mutation = mutationSchema.parse(await request.json());
    const result = await service.mutate(session.user.id, mutation);
    console.info(
      JSON.stringify({
        event: "sync.mutation",
        organization: mutation.organizationId,
        user: session.user.id,
        mutationId: mutation.id,
        mutationType: mutation.command.type,
        retryCount: Math.min(
          100,
          Math.max(0, Number(request.headers.get("X-Sync-Attempt") ?? 1) - 1),
        ),
        duration: Date.now() - start,
      }),
    );
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
