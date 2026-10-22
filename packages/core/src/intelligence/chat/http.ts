
import { CapabilityError } from "@lictory/core/capabilities/core";
import { webPrincipal } from "@lictory/core/capabilities/http";
import { db } from "@lictory/core/db";
import { aiPolicy } from "@lictory/core/domain/ai";
import { directory } from "@lictory/core/domain/service";

// Resolves the signed-in person and checks they belong to the organization
// before any chat is read or written. `requireAi` also enforces the
// organization's Lictory Intelligence opt-in and the deployment's provider
// configuration.
export async function chatOwner(
  request: Request,
  organizationId: unknown,
  options: { requireAi?: boolean } = {},
) {
  if (typeof organizationId !== "string" || !organizationId)
    throw new CapabilityError("validation", "organizationId is required.");
  const { userId } = await webPrincipal(request);
  const roster = await directory(db, userId, organizationId);
  if (options.requireAi) {
    const ai = await aiPolicy(db, organizationId);
    if (!ai.available)
      throw new CapabilityError(
        "unavailable",
        "Lictory Intelligence is not configured on this server. Ask an administrator to set OPENAI_API_KEY.",
      );
    if (!ai.enabled)
      throw new CapabilityError(
        "forbidden",
        "Lictory Intelligence is turned off for this organization. An administrator can enable it in Settings → Lictory Intelligence.",
      );
  }
  return { owner: { organizationId, userId }, roster };
}
