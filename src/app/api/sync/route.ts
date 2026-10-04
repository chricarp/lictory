import { after } from "next/server";
import { z } from "zod";
import { kickAiRuns } from "~/ai/runner";
import { committedEvents } from "~/lib/analytics/events";
import { trackServer, trackServerFailure } from "~/lib/analytics/server";
import { db } from "~/db";
import { kickNotificationEmails } from "~/notifications/email";
import { auth } from "~/lib/auth";
import {
  createSyncService,
  directory,
  DomainError,
  iterationReport,
  searchEpics,
  searchMembers,
} from "~/sync/server/service";
import {
  checkpointSchema,
  epicSearchSchema,
  iterationReportQuerySchema,
  memberSearchSchema,
  mutationSchema,
  pageSchema,
  scopeSchema,
} from "~/sync/shared/protocol";

const service = createSyncService(db);
const aiTriggers = new Set([
  "requestAiReview",
  "rerunAiAction",
  "createAiCorrectivePr",
  "applyAiSuggestion",
  "commitBranch",
  "syncBranch",
  "createPullRequest",
  "setPullRequestDraft",
]);
export const dynamic = "force-dynamic";
// Lictory AI runs after the response (see `after` below) and may take minutes.
export const maxDuration = 300;
type RequestContext = {
  operation:
    "read" | "mutation" | "directory" | "members" | "epics" | "iteration";
  organization?: string;
  user: string;
  mutationId?: string;
  mutationType?: string;
};
function describe(error: unknown) {
  if (error instanceof Error)
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      // postgres.js attaches SQL diagnostics (code, detail, table, constraint) to the error.
      code: (error as { code?: unknown }).code,
      detail: (error as { detail?: unknown }).detail,
      constraint: (error as { constraint?: unknown }).constraint,
      table: (error as { table?: unknown }).table,
      cause: error.cause instanceof Error ? error.cause.message : error.cause,
    };
  return { message: String(error) };
}
function failure(error: unknown, context: RequestContext) {
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
  if (error instanceof z.ZodError) {
    console.warn(
      JSON.stringify({
        event: "sync.invalid",
        ...context,
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      }),
    );
    return Response.json(
      { error: { category: "validation", message: "Invalid sync request." } },
      { status: 400 },
    );
  }
  console.error(
    JSON.stringify({
      event: "sync.error",
      category: "server",
      ...context,
      error: describe(error),
    }),
  );
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
  const context: RequestContext = { operation: "read", user: session.user.id };
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    context.organization = params.organizationId;
    if (params.directory === "1") {
      context.operation = "directory";
      return Response.json(
        await directory(db, session.user.id, params.organizationId),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (params.members === "1") {
      context.operation = "members";
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
      context.operation = "epics";
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
    if (params.iteration === "1") {
      context.operation = "iteration";
      const query = iterationReportQuerySchema.parse(params);
      return Response.json(
        await iterationReport(
          db,
          session.user.id,
          query.organizationId,
          query.iterationId,
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
    trackServerFailure(
      session.user.id,
      context.mutationType ?? context.operation,
      error,
      request.headers,
    );
    return failure(error, context);
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
  const context: RequestContext = {
    operation: "mutation",
    user: session.user.id,
  };
  try {
    const mutation = mutationSchema.parse(await request.json());
    context.organization = mutation.organizationId;
    context.mutationId = mutation.id;
    context.mutationType = mutation.command.type;
    const trackedService = createSyncService(db, {
      onMutationCommitted: (userId, committed, snapshots) => {
        for (const event of committedEvents(
          committed.command,
          snapshots.before,
          snapshots.after,
          snapshots.directory,
        )) {
          trackServer(
            userId,
            event.event,
            {
              ...event.properties,
              organization_id: committed.organizationId,
              mutation_id: committed.id,
            },
            request.headers,
            `${committed.organizationId}:${committed.id}:${String(event.properties.work_item_id ?? "")}`,
          );
        }
      },
    });
    const result = await trackedService.mutate(session.user.id, mutation);
    kickNotificationEmails(db);
    // AI requests, new pull request commits and opened PRs may queue runs.
    if (aiTriggers.has(mutation.command.type)) after(() => kickAiRuns(db));
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
    trackServerFailure(
      session.user.id,
      context.mutationType ?? context.operation,
      error,
      request.headers,
    );
    return failure(error, context);
  }
}
