import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import { queueNotifications } from "@lictory/core/notifications/events";
import { writeSummary } from "@lictory/core/code/write-summary";

// The requester hears once when a write they asked for fails for good
// (temporary failures are retried first). Writes the autonomy policy asked
// for notify the administrator who configured it, who is the requester.
export async function notifyCodeWriteFailed(
  tx: Tx,
  write: typeof s.codeWrite.$inferSelect,
  message: string,
) {
  const [repository] = await tx
    .select({ fullName: s.codeRepository.fullName })
    .from(s.codeRepository)
    .where(
      and(
        eq(s.codeRepository.organizationId, write.organizationId),
        eq(s.codeRepository.id, write.repositoryId),
      ),
    );
  const [item] = write.workItemId
    ? await tx
        .select({ projectId: s.workItem.projectId, teamId: s.workItem.teamId })
        .from(s.workItem)
        .where(
          and(
            eq(s.workItem.organizationId, write.organizationId),
            eq(s.workItem.id, write.workItemId),
          ),
        )
    : [];
  await queueNotifications(tx, write.organizationId, [
    {
      userIds: [write.requestedById],
      kind: "code_write_failed",
      actorId: null,
      projectId: item?.projectId ?? null,
      teamId: item?.teamId ?? null,
      workItemId: write.workItemId,
      detail: {
        writeId: write.id,
        kind: write.kind,
        summary: writeSummary(write.kind, write.payload),
        repository: repository?.fullName ?? null,
        pullRequestId: write.pullRequestId,
        message,
      },
      dedupeKey: `code-write-failed:${write.id}:${write.attempts}`,
    },
  ]);
}
