import { z } from "zod";
import { CapabilityError } from "@lictory/core/capabilities/core";
import {
  errorResponse,
  invokeForWeb,
  noStore,
  requireSameOrigin,
  webPrincipal,
} from "@lictory/core/capabilities/http";
import { MAX_CONTEXT_DOCUMENT_SIZE } from "@lictory/core/intelligence/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = RouteContext<"/api/organizations/[id]/intelligence-context">;

// Every member can read what steers Lictory Intelligence.
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      await invokeForWeb(request, "listIntelligenceContext", {
        organizationId: id,
      }),
      noStore,
    );
  } catch (error) {
    return errorResponse(error, "string");
  }
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
};

// One endpoint for every change, as multipart form data so documents and
// notes share a shape: create, revise (new version), archive and restore.
export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { id: organizationId } = await context.params;
    const principal = await webPrincipal(request);
    // Multipart framing adds a little to the document itself.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_CONTEXT_DOCUMENT_SIZE + 64 * 1024)
      throw new CapabilityError(
        "validation",
        `Documents can be at most ${MAX_CONTEXT_DOCUMENT_SIZE / 1024 / 1024} MB.`,
        { status: 413 },
      );
    const form = await request.formData();
    const action = z
      .enum(["create", "revise", "archive", "restore"])
      .parse(field(form, "action"));
    const run = (name: string, input: unknown) =>
      invokeForWeb(request, name, input, { principal });
    if (action === "archive" || action === "restore")
      return Response.json(
        await run("archiveIntelligenceContext", {
          organizationId,
          entryId: field(form, "entryId"),
          archived: action === "archive",
        }),
      );
    const file = form.get("file");
    const body = {
      organizationId,
      title: field(form, "title") ?? "",
      content: field(form, "content"),
      file:
        file instanceof File
          ? {
              filename: file.name,
              contentBase64: Buffer.from(await file.arrayBuffer()).toString(
                "base64",
              ),
            }
          : undefined,
    };
    if (action === "create")
      return Response.json(
        await run("createIntelligenceContext", {
          ...body,
          target: {
            scope: field(form, "scope"),
            projectId: field(form, "projectId"),
            teamId: field(form, "teamId"),
          },
        }),
      );
    return Response.json(
      await run("reviseIntelligenceContext", {
        ...body,
        entryId: field(form, "entryId"),
      }),
    );
  } catch (error) {
    return errorResponse(error, "string");
  }
}
