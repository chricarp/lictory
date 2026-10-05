import { z } from "zod";
import { db } from "~/db";
import { convertDocument } from "~/intelligence/convert";
import { contextFailure, sameOrigin, sessionUser } from "~/intelligence/http";
import {
  ContextError,
  canManageIntelligenceContext,
  createIntelligenceContext,
  listIntelligenceContext,
  reviseIntelligenceContext,
  setIntelligenceContextArchived,
  type ContextInput,
} from "~/intelligence/server";
import {
  MAX_CONTEXT_DOCUMENT_SIZE,
  contextTarget,
} from "~/intelligence/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = RouteContext<"/api/organizations/[id]/intelligence-context">;

// Every member can read what steers Lictory AI.
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const userId = await sessionUser(request);
    return Response.json(await listIntelligenceContext(db, id, userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return contextFailure(error);
  }
}

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
};

// One endpoint for every change, as multipart form data so documents and
// notes share a shape: create, revise (new version), archive and restore.
// The service re-checks authorization under the organization lock.
export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { id: organizationId } = await context.params;
    const userId = await sessionUser(request);
    // Reject before reading or converting anything a non-administrator sent.
    if (!(await canManageIntelligenceContext(db, organizationId, userId)))
      throw new ContextError(
        "Only organization administrators can change Lictory Intelligence Context.",
        403,
      );
    // Multipart framing adds a little to the document itself.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_CONTEXT_DOCUMENT_SIZE + 64 * 1024)
      throw new ContextError(
        `Documents can be at most ${MAX_CONTEXT_DOCUMENT_SIZE / 1024 / 1024} MB.`,
        413,
      );
    const form = await request.formData();
    const action = z
      .enum(["create", "revise", "archive", "restore"])
      .parse(field(form, "action"));
    if (action === "archive" || action === "restore")
      return Response.json(
        await setIntelligenceContextArchived(
          db,
          organizationId,
          userId,
          z.string().min(1).parse(field(form, "entryId")),
          action === "archive",
        ),
      );
    const input: ContextInput = {
      title: field(form, "title") ?? "",
      content: field(form, "content"),
    };
    const file = form.get("file");
    if (file instanceof File) {
      const document = await convertDocument(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      input.document = { ...document, filename: file.name };
      input.content = undefined;
    }
    if (action === "create")
      return Response.json(
        await createIntelligenceContext(
          db,
          organizationId,
          userId,
          contextTarget.parse({
            scope: field(form, "scope"),
            projectId: field(form, "projectId"),
            teamId: field(form, "teamId"),
          }),
          input,
        ),
      );
    return Response.json(
      await reviseIntelligenceContext(
        db,
        organizationId,
        userId,
        z.string().min(1).parse(field(form, "entryId")),
        input,
      ),
    );
  } catch (error) {
    return contextFailure(error);
  }
}
