"use client";
import { createContext, useContext, useMemo } from "react";
import type { View } from "~/sync/client/engine";
import type {
  WorkItemType,
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
  threads: EntityOf<"thread">[]; // about the specification itself
  suggestionThreads: EntityOf<"thread">[]; // about a suggestion's proposed text
  messages: EntityOf<"message">[];
  suggestions: EntityOf<"suggestion">[];
  suggestionReviewers: EntityOf<"suggestionReviewer">[];
  suggestionDecisions: EntityOf<"suggestionDecision">[];
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
  // Configured type; `reviewable` when it carries a specification (revisions,
  // suggestions, threads, reviews, readiness). Other types keep a plain,
  // revisioned description.
  type: WorkItemType;
  reviewable: boolean;
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
  type: WorkItemType;
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
    type,
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
    const allThreads = byType(scoped, "thread").sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return {
      item,
      type,
      reviewable: type.hasSpecification,
      project,
      entities: scoped,
      revisions,
      current,
      threads: allThreads.filter((t) => !t.suggestionId),
      suggestionThreads: allThreads.filter((t) => Boolean(t.suggestionId)),
      messages: byType(scoped, "message").sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
      suggestions: byType(scoped, "suggestion").sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      suggestionReviewers: byType(scoped, "suggestionReviewer"),
      suggestionDecisions: byType(scoped, "suggestionDecision").sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
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
    type,
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
