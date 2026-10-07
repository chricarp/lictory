import {
  invokeForWeb,
  errorResponse,
  noStore,
  webPrincipal,
} from "~/capabilities/http";
import { CapabilityError } from "~/capabilities/core";
import { pageSchema } from "~/sync/shared/protocol";

export const dynamic = "force-dynamic";
// Lictory AI runs after the response and may take minutes.
export const maxDuration = 300;

// The browser's synchronization endpoint. Reads and writes are capabilities
// of the shared application layer (src/capabilities), exactly as invoked by
// MCP clients and the embedded agent.

function logInvalid(error: unknown, context: Record<string, unknown>) {
  if (error instanceof CapabilityError && error.details.issues)
    console.warn(
      JSON.stringify({
        event: "sync.invalid",
        ...context,
        issues: error.details.issues,
      }),
    );
}

export async function GET(request: Request) {
  const start = Date.now();
  let context: Record<string, unknown> = { operation: "read" };
  try {
    const principal = await webPrincipal(
      request,
      "Sign in again to synchronize.",
    );
    const params = Object.fromEntries(new URL(request.url).searchParams);
    context = {
      ...context,
      user: principal.userId,
      organization: params.organizationId,
    };
    const run = (name: string, input: unknown) =>
      invokeForWeb(request, name, input, { principal });
    if (params.directory === "1") {
      context.operation = "directory";
      return Response.json(
        await run("syncDirectory", { organizationId: params.organizationId }),
        noStore,
      );
    }
    if (params.members === "1") {
      context.operation = "members";
      return Response.json(await run("searchMembers", params), noStore);
    }
    if (params.epics === "1") {
      context.operation = "epics";
      return Response.json(await run("searchEpics", params), noStore);
    }
    if (params.iteration === "1") {
      context.operation = "iteration";
      return Response.json(await run("getIterationReport", params), noStore);
    }
    const page = pageSchema.parse(
      await run("syncRead", {
        scope: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          workItemId: params.workItemId,
        },
        cursor: params.cursor,
      }),
    );
    console.info(
      JSON.stringify({
        event: "sync.read",
        organization: params.organizationId,
        user: principal.userId,
        checkpoint: page.nextCursor,
        changes: page.changes.length,
        duration: Date.now() - start,
      }),
    );
    return Response.json(page, noStore);
  } catch (error) {
    logInvalid(error, context);
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const start = Date.now();
  let context: Record<string, unknown> = { operation: "mutation" };
  try {
    const principal = await webPrincipal(
      request,
      "Sign in again to save changes.",
    );
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      organizationId?: unknown;
      command?: { type?: unknown };
    } | null;
    context = {
      ...context,
      user: principal.userId,
      organization: body?.organizationId,
      mutationId: body?.id,
      mutationType: body?.command?.type,
    };
    const result = await invokeForWeb(request, "applyMutation", body, {
      write: true,
      principal,
    });
    console.info(
      JSON.stringify({
        event: "sync.mutation",
        ...context,
        retryCount: Math.min(
          100,
          Math.max(0, Number(request.headers.get("X-Sync-Attempt") ?? 1) - 1),
        ),
        duration: Date.now() - start,
      }),
    );
    return Response.json(result);
  } catch (error) {
    logInvalid(error, context);
    return errorResponse(error);
  }
}
