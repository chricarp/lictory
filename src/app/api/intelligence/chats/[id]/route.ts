import { z } from "zod";
import { CapabilityError } from "~/capabilities/core";
import { errorResponse, noStore, requireSameOrigin } from "~/capabilities/http";
import { db } from "~/db";
import { chatOwner } from "~/intelligence/chat/http";
import { deleteChat, getChat, updateChat } from "~/intelligence/chat/store";

export const dynamic = "force-dynamic";

type Context = RouteContext<"/api/intelligence/chats/[id]">;
const notFound = () =>
  new CapabilityError("validation", "This conversation no longer exists.", {
    status: 404,
  });
const orgOf = (request: Request) =>
  new URL(request.url).searchParams.get("organizationId");

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { owner } = await chatOwner(request, orgOf(request));
    const found = await getChat(db, owner, id);
    if (!found) return Response.json({ chat: null, messages: [] }, noStore);
    return Response.json(
      {
        chat: {
          id: found.chat.id,
          title: found.chat.title,
          pinned: found.chat.pinned,
        },
        messages: found.messages,
      },
      noStore,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

const patch = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    // Continuing a dock conversation on the page adds it to the history.
    listed: z.literal(true).optional(),
  })
  .strict();

export async function PATCH(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const { owner } = await chatOwner(request, orgOf(request));
    const chat = await updateChat(
      db,
      owner,
      id,
      patch.parse(await request.json()),
    );
    if (!chat) throw notFound();
    return Response.json({ ok: true }, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const { owner } = await chatOwner(request, orgOf(request));
    if (!(await deleteChat(db, owner, id))) throw notFound();
    return Response.json({ ok: true }, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}
