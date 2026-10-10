import * as s from "../../db/schema";
import type { Command } from "../shared/protocol";
import type { Tx } from "./service";

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
