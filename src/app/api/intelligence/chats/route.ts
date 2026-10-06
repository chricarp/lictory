import { errorResponse, noStore } from "~/capabilities/http";
import { db } from "~/db";
import { chatOwner } from "~/intelligence/chat/http";
import { listChats } from "~/intelligence/chat/store";

export const dynamic = "force-dynamic";

// The signed-in person's own Intelligence conversations in one organization.
export async function GET(request: Request) {
  try {
    const organizationId = new URL(request.url).searchParams.get(
      "organizationId",
    );
    const { owner } = await chatOwner(request, organizationId);
    return Response.json({ chats: await listChats(db, owner) }, noStore);
  } catch (error) {
    return errorResponse(error);
  }
}
