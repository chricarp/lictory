import type { Command, Directory } from "../shared/protocol";
import type { Entities } from "./reconciliation";

// Local feedback only. The server still validates against current readiness.
export function statusChangeBlocker(
  command: Command,
  entities: Entities,
  directory: Directory,
): string | undefined {
  if (command.type !== "updateWorkItem" || !command.statusId) return;
  const item = entities[`workItem:${command.workItemId}`];
  if (item?.type !== "workItem") return;
  const project = directory.projects.find((p) => p.id === item.projectId);
  const type = directory.types.find(
    (t) => t.id === (command.typeId ?? item.typeId),
  );
  const statuses = directory.statuses.filter(
    (s) => s.projectId === item.projectId,
  );
  const from = statuses.find((s) => s.id === item.statusId);
  const to = statuses.find((s) => s.id === command.statusId && !s.archivedAt);
  if (
    !project ||
    !type ||
    !from ||
    !to ||
    project.readinessPolicy !== "block" ||
    !type.hasSpecification ||
    item.refinementState === "ready" ||
    from.category === "started" ||
    to.category !== "started" ||
    command.statusId === item.statusId
  )
    return;
  const readiness = entities[`readiness:${item.id}`];
  const failing =
    readiness?.type === "readiness"
      ? readiness.checks
          .filter((check) => !check.passed)
          .map((check) => check.label.toLowerCase())
      : [];
  const detail = failing.length
    ? failing.join("; ")
    : `${item.readinessPassed}/${item.readinessTotal} readiness checks pass${item.blockingThreads ? `, ${item.blockingThreads} blocking discussion${item.blockingThreads > 1 ? "s" : ""}` : ""}`;
  return `${project?.key ?? "Item"}-${item.number} is not ready to start: ${detail}. Complete the required reviews and readiness checks first.`;
}
