import { eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  lock,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { aiPolicy } from "@lictory/core/domain/ai";

// Slack content and AI providers (docs/internals/channels.md#ai). Messages
// written in Slack reach Lictory Intelligence (Litto's channel reads, and
// anything else that sends channel text to the AI provider) only when the
// organization's AI policy is on AND an administrator allowed Lictory
// Intelligence to read Slack messages. Otherwise their text is withheld from
// those reads. Lictory never sends Slack data to an AI provider by itself.

export async function intelligenceMayReadSlack(
  db: Database | Tx,
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ allowed: s.slackInstallation.intelligenceReads })
    .from(s.slackInstallation)
    .where(eq(s.slackInstallation.organizationId, organizationId));
  if (!row?.allowed) return false;
  return (await aiPolicy(db, organizationId)).enabled;
}

export async function setSlackIntelligenceReads(
  db: Database,
  userId: string,
  input: { organizationId: string; allowed: boolean },
) {
  return db.transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const membership = await authorize(tx, userId, input.organizationId);
    if (!isAdmin(membership))
      throw new DomainError(
        "forbidden",
        "An organization administrator decides whether Lictory Intelligence reads Slack messages.",
      );
    const updated = await tx
      .update(s.slackInstallation)
      .set({ intelligenceReads: input.allowed })
      .where(eq(s.slackInstallation.organizationId, input.organizationId))
      .returning({ id: s.slackInstallation.id });
    if (!updated.length)
      throw new DomainError(
        "conflict",
        "Connect Slack first.",
        undefined,
        "invalid_state",
      );
    await tx.insert(s.configurationAudit).values({
      organizationId: input.organizationId,
      actorId: userId,
      action: "setSlackIntelligenceReads",
      detail: { allowed: input.allowed },
    });
    return { allowed: input.allowed };
  });
}
