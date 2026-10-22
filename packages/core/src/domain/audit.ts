import * as s from "@lictory/core/db/schema";
import type { Command } from "@lictory/core/contracts/protocol";
import type { Tx } from "@lictory/core/domain/service";

// Configuration changes keep their actor, command and previous definition.
export async function auditConfiguration(
  tx: Tx,
  organizationId: string,
  actorId: string,
  command: Command,
  previous?: unknown,
) {
  await tx.insert(s.configurationAudit).values({
    organizationId,
    actorId,
    action: command.type,
    detail: { command, ...(previous === undefined ? {} : { previous }) },
  });
}
