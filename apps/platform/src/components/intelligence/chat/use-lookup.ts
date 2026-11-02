import { useMemo } from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { paths } from "@lictory/core/lib/paths";
import { identifier } from "@lictory/core/lib/work-items";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import type {
  ItemRef,
  Lookup,
  RefKind,
} from "@lictory/platform/components/intelligence/chat/activity";

// Resolves the ids in the assistant's tool calls against the synced workspace,
// so the chat names items, people and statuses instead of showing UUIDs.
export function useLookup(): Lookup {
  const {
    organization,
    projects,
    items,
    labels,
    milestones,
    delivery,
    directory,
  } = useWorkspace();
  return useMemo(() => {
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const byId = new Map(items.map((i) => [i.id, i]));
    const byKey = new Map(
      items.map((i) => [
        identifier(projectById.get(i.projectId), i.number).toUpperCase(),
        i,
      ]),
    );
    const names: Record<RefKind, Map<string, string>> = {
      project: new Map(projects.map((p) => [p.id, p.name])),
      member: new Map(directory.members.map((m) => [m.id, m.name])),
      status: new Map([...delivery.statuses].map(([id, s]) => [id, s.name])),
      type: new Map([...delivery.types].map(([id, t]) => [id, t.name])),
      team: new Map([...delivery.teams].map(([id, t]) => [id, t.name])),
      iteration: new Map(
        [...delivery.iterations].map(([id, i]) => [id, iterationLabel(i)]),
      ),
      discipline: new Map(directory.disciplines.map((d) => [d.id, d.name])),
      label: new Map(labels.map((l) => [l.id, l.name])),
      milestone: new Map(milestones.map((m) => [m.id, m.name])),
    };
    return {
      item({ id, key }): ItemRef | undefined {
        const item =
          (id ? byId.get(id) : undefined) ??
          (key ? byKey.get(key.toUpperCase()) : undefined);
        if (!item) return undefined;
        const project = projectById.get(item.projectId);
        const itemKey = identifier(project, item.number);
        return {
          id: item.id,
          key: itemKey,
          title: item.title,
          href: project
            ? paths.item(organization.slug, project.key, itemKey)
            : undefined,
        };
      },
      name: (kind, id) => names[kind].get(id),
    };
  }, [
    organization.slug,
    projects,
    items,
    labels,
    milestones,
    delivery,
    directory,
  ]);
}
