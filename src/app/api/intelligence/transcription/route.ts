import { z } from "zod";
import { errorResponse, noStore, requireSameOrigin } from "~/capabilities/http";
import { chatOwner } from "~/intelligence/chat/http";
import { createDictationSession } from "~/intelligence/voice/transcription";

export const dynamic = "force-dynamic";

const body = z.object({ organizationId: z.string().min(1) });

// Mints a short-lived, transcription-only credential so the composer can
// stream the microphone directly to the provider. Same membership and
// Lictory Intelligence opt-in checks as the chat itself; no audio passes
// through here.
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = body.parse(await request.json());
    const { owner } = await chatOwner(request, input.organizationId, {
      requireAi: true,
    });
    return Response.json(await createDictationSession(owner.userId), noStore);
  } catch (error) {
    return errorResponse(error);
  }
}
