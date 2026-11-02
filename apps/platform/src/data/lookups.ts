import { callCapability } from "@lictory/core/capabilities/client";
import {
  epicPageSchema,
  iterationReportSchema,
  memberPageSchema,
  readinessHistorySchema,
} from "@lictory/core/contracts/protocol";

// Reads too large or too derived to synchronize go through capabilities, with
// the same authorization as every other caller.

export async function searchMembers(
  organizationId: string,
  query: string,
  offset: number,
  limit = 20,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const page = await callCapability("searchMembers", {
    organizationId,
    q: query,
    offset,
    limit,
  });
  signal?.throwIfAborted();
  return memberPageSchema.parse(page);
}

export async function searchEpics(
  organizationId: string,
  projectId: string,
  query: string,
  offset: number,
  limit = 20,
  signal?: AbortSignal,
  childTypeId?: string,
) {
  signal?.throwIfAborted();
  const page = await callCapability("searchEpics", {
    organizationId,
    projectId,
    childTypeId,
    q: query,
    offset,
    limit,
  });
  signal?.throwIfAborted();
  return epicPageSchema.parse(page);
}

export async function iterationReport(
  organizationId: string,
  iterationId: string,
) {
  return iterationReportSchema.parse(
    await callCapability("getIterationReport", { organizationId, iterationId }),
  );
}

export async function readinessHistory(
  organizationId: string,
  projectId: string,
) {
  return readinessHistorySchema.parse(
    await callCapability("getReadinessHistory", { organizationId, projectId }),
  ).revisions;
}
