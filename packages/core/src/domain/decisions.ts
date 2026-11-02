import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Capabilities, Command } from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import type { Tx } from "@lictory/core/domain/service";

export async function applyDecisionCommand(
  tx: Tx,
  command: Extract<Command, { type: "recordDecision" | "setDecisionArchived" }>,
  ctx: {
    organizationId: string;
    projectId: string;
    userId: string;
    capabilities: Capabilities;
    log: (action: string, detail: Record<string, unknown>) => void;
  },
) {
  const { organizationId, projectId, userId, capabilities, log } = ctx;
  if (command.type === "recordDecision") {
    if (!capabilities.editSpecifications && !capabilities.review)
      throw new DomainError(
        "forbidden",
        "Recording a conclusion requires a discipline that edits specifications or reviews.",
      );
    let revisionId = command.baseRevisionId;
    if (command.sourceThreadId) {
      const [thread] = await tx
        .select()
        .from(s.thread)
        .where(
          and(
            eq(s.thread.organizationId, organizationId),
            eq(s.thread.workItemId, command.workItemId),
            eq(s.thread.id, command.sourceThreadId),
          ),
        );
      if (!thread || thread.pullRequestId || thread.suggestionId)
        throw new DomainError(
          "validation",
          "Choose a discussion on this specification.",
        );
      if (thread.status !== "resolved")
        throw new DomainError(
          "conflict",
          "Resolve the discussion before recording its conclusion.",
        );
      revisionId = thread.revisionId;
    }
    await tx.insert(s.decision).values({
      id: command.decisionId,
      organizationId,
      projectId,
      workItemId: command.workItemId,
      revisionId,
      sourceThreadId: command.sourceThreadId ?? null,
      title: command.title,
      body: command.body,
      authorId: userId,
    });
    log("decision_recorded", {
      decisionId: command.decisionId,
      title: command.title,
      revisionId,
      sourceThreadId: command.sourceThreadId ?? null,
    });
    return;
  }
  const [decision] = await tx
    .select()
    .from(s.decision)
    .where(
      and(
        eq(s.decision.organizationId, organizationId),
        eq(s.decision.workItemId, command.workItemId),
        eq(s.decision.id, command.decisionId),
      ),
    );
  if (!decision)
    throw new DomainError("not_found", "This decision is unavailable.");
  if (decision.authorId !== userId && !capabilities.editSpecifications)
    throw new DomainError(
      "forbidden",
      "Only the author or a specification editor may archive or restore this decision.",
    );
  if (Boolean(decision.archivedAt) === command.archived) return;
  await tx
    .update(s.decision)
    .set({ archivedAt: command.archived ? new Date() : null })
    .where(
      and(
        eq(s.decision.organizationId, organizationId),
        eq(s.decision.id, decision.id),
      ),
    );
  log("decision_archive_changed", {
    decisionId: decision.id,
    title: decision.title,
    archived: command.archived,
  });
}
