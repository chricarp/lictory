import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@lictory/core/domain/service";

// After-commit signals to the collaboration service (apps/collaboration):
// whose live draft connections to recheck, and which drafts were fenced or
// replaced by a new epoch. PostgreSQL delivers NOTIFY only when the
// transaction commits, so the service never acts on a change that rolled
// back. Signals carry identifiers only, never content. They are a shortcut:
// the service also revalidates every connection periodically, so a lost
// signal only delays a revocation.
//
// Draft signals come from a trigger on `space_draft` (migration
// 0036_space_draft_signal), so every writer that fences a draft or starts a
// new epoch signals without having to remember to.
export const SPACES_ACCESS_CHANNEL = "lictory_spaces_access";

export const spacesAccessSignalSchema = z.object({
  organizationId: z.string(),
  userIds: z.array(z.string()).default([]),
  draftIds: z.array(z.string()).default([]),
});
export type SpacesAccessSignal = z.infer<typeof spacesAccessSignalSchema>;

// NOTIFY payloads are limited to 8000 bytes; 100 ids stay well below it.
const PER_SIGNAL = 100;

export async function signalSpaceAccess(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
) {
  for (let index = 0; index < userIds.length; index += PER_SIGNAL) {
    const payload = JSON.stringify({
      organizationId,
      userIds: userIds.slice(index, index + PER_SIGNAL),
    });
    await tx.execute(
      sql`select pg_notify(${SPACES_ACCESS_CHANNEL}, ${payload})`,
    );
  }
}
