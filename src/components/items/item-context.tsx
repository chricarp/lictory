"use client";
import { createContext, useContext, useMemo } from "react";
import type { View } from "~/sync/client/engine";
import type {
  Capabilities,
  Command,
  Entity,
  EntityOf,
  WorkItem,
} from "~/sync/shared/protocol";
import { byType, type Project } from "~/lib/work-items";

export type Revision = EntityOf<"revision">;

export type ItemContextValue = {
  item: WorkItem;
  project: Project;
  entities: Entity[];
  revisions: Revision[]; // newest first
  current: Revision | undefined;
  threads: EntityOf<"thread">[];
  messages: EntityOf<"message">[];
  suggestions: EntityOf<"suggestion">[];
  reviews: EntityOf<"review">[];
  assignments: EntityOf<"assignment">[];
  approvals: EntityOf<"approval">[];
  readiness: EntityOf<"readiness"> | undefined;
  activity: EntityOf<"activity">[];
  view: View;
  userId: string;
  roleIds: string[];
  memberName: (id: string | null | undefined) => string;
  roleName: (id: string | null | undefined) => string;
  mutate: (command: Command) => Promise<string>;
  // Archived or not yet confirmed: nothing about the item can change.
  readOnly: boolean;
  // What my organization roles allow on this item; the server re-checks.
  canEdit: boolean; // specification text, title, creation of children
  canChangeProperties: boolean; // status, priority, owner, epic, labels, milestone
  canRequestReviews: boolean;
  capabilities: Capabilities;
  // Commands that must target the exact current revision.
  base: { workItemId: string; baseRevisionId: string };
  revisionNumber: (id: string) => number | undefined;
};

export const ItemContext = createContext<ItemContextValue | null>(null);
export function useItem() {
  const value = useContext(ItemContext);
  if (!value) throw new Error("useItem requires ItemDetail.");
  return value;
}

export function useItemContextValue(input: {
  item: WorkItem;
  project: Project;
  entities: Entity[];
  view: View;
  userId: string;
  roleIds: string[];
  memberName: ItemContextValue["memberName"];
  roleName: ItemContextValue["roleName"];
  capabilities: Capabilities;
  mutate: ItemContextValue["mutate"];
}): ItemContextValue {
  const {
    item,
    project,
    entities,
    view,
    userId,
    roleIds,
    memberName,
    roleName,
    capabilities,
    mutate,
  } = input;
  return useMemo(() => {
    const scoped = entities.filter(
      (e) => !("workItemId" in e) || e.workItemId === item.id,
    );
    const revisions = byType(scoped, "revision").sort(
      (a, b) => b.number - a.number,
    );
    const current = revisions[0];
    const readOnly =
      Boolean(item.archivedAt) || !current || current.id.startsWith("pending:");
    return {
      item,
      project,
      entities: scoped,
      revisions,
      current,
      threads: byType(scoped, "thread").sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
      messages: byType(scoped, "message").sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
      suggestions: byType(scoped, "suggestion").sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      reviews: byType(scoped, "review"),
      assignments: byType(scoped, "assignment"),
      approvals: byType(scoped, "approval"),
      readiness: byType(scoped, "readiness").find(
        (r) => r.workItemId === item.id,
      ),
      activity: byType(scoped, "activity").sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      view,
      userId,
      roleIds,
      memberName,
      roleName,
      mutate,
      readOnly,
      canEdit: !readOnly && capabilities.editSpecifications,
      canChangeProperties: !readOnly && capabilities.changeProperties,
      canRequestReviews: !readOnly && capabilities.requestReviews,
      capabilities,
      base: { workItemId: item.id, baseRevisionId: current?.id ?? "" },
      revisionNumber: (id) => revisions.find((r) => r.id === id)?.number,
    };
  }, [
    item,
    project,
    entities,
    view,
    userId,
    roleIds,
    memberName,
    roleName,
    capabilities,
    mutate,
  ]);
}
