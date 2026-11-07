import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  iterationLabel,
  type LabelColor,
  type RefinementState,
  type StatusCategory,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import {
  deliveryCategory,
  externalLinksByItem,
} from "@lictory/core/lib/lifecycle";
import { paths } from "@lictory/core/lib/paths";
import { identifier, typeOf } from "@lictory/core/lib/work-items";
import { useOptionalWorkspace } from "@lictory/platform/components/workspace/provider";
import { useOptionalSpaceIndex } from "@lictory/platform/components/spaces/store";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import { ancestorsOf, type Space } from "@lictory/platform/data/spaces";
import { ItemContext } from "@lictory/platform/components/items/item-context";

// What a reference shows, resolved against what I may read now. A target I
// cannot read resolves to undefined: chips then show only the label stored
// in the content, never more. Nothing here is fetched: items, pages and the
// open item's decisions are already synchronized for me.

export type ItemReference = {
  id: string;
  key: string;
  title: string;
  href: string | undefined;
  typeName: string;
  // Delivery status as the rest of Work shows it: the delivery tool's
  // status for projects that deliver externally, the workflow status
  // otherwise.
  status: {
    label: string;
    category: StatusCategory | undefined;
    color?: LabelColor;
  };
  refinement: RefinementState | null;
  readiness: { passed: number; total: number; blocked: boolean } | null;
  owner: string | null;
  iteration: string | null;
  archived: boolean;
};

export type PageReference = {
  id: string;
  title: string;
  href: string;
  space: Pick<Space, "id" | "name" | "icon" | "accessMode">;
  // Ancestor page titles, outermost first.
  path: string[];
  publishedCommitId: string;
  publishedAt: string;
  publishedBy: string | null;
  archived: boolean;
};

export type DecisionReference = {
  id: string;
  title: string;
  itemKey: string | null;
  itemHref: string | null;
  revisionNumber: number | null;
};

type Resolver = {
  item: (id: string) => ItemReference | undefined;
  page: (id: string) => PageReference | undefined;
  // Items I can see, for the "#" picker.
  items: () => readonly {
    id: string;
    key: string;
    title: string;
    archived: boolean;
  }[];
  // Pages I can read, for the "[[" picker.
  pages: () => readonly {
    id: string;
    title: string;
    space: string;
    publishedCommitId: string;
    archived: boolean;
  }[];
  organizationId: string | null;
};

const empty: Resolver = {
  item: () => undefined,
  page: () => undefined,
  items: () => [],
  pages: () => [],
  organizationId: null,
};

const ResolverContext = createContext<Resolver | null>(null);

function useResolverValue(): Resolver {
  const workspace = useOptionalWorkspace();
  const index = useOptionalSpaceIndex();
  const items = workspace?.items;
  const projects = workspace?.projects;
  const delivery = workspace?.delivery;
  const directory = workspace?.directory;
  const entities = workspace?.view.entities;
  const memberName = workspace?.memberName;
  const slug = workspace?.organization.slug;
  const organizationId = workspace?.organization.id ?? null;
  return useMemo<Resolver>(() => {
    if (!items || !projects || !delivery || !directory || !memberName || !slug)
      return empty;
    const itemById = new Map(items.map((i) => [i.id, i]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const links = externalLinksByItem(
      Object.values(entities ?? {}),
      directory.delivery.targets,
    );
    const resolved = new Map<string, ItemReference>();
    const keyOf = (item: WorkItem) =>
      identifier(projectById.get(item.projectId), item.number);
    const item = (id: string) => {
      const cached = resolved.get(id);
      if (cached) return cached;
      const found = itemById.get(id);
      if (!found) return undefined;
      const project = projectById.get(found.projectId);
      const type = typeOf(delivery, found);
      const key = keyOf(found);
      const external = project?.deliveryMode === "external";
      const link = links.get(found.id);
      const tool = projectDeliveryTool(directory, found.projectId);
      const status = delivery.statuses.get(found.statusId);
      const iteration = found.iterationId
        ? delivery.iterations.get(found.iterationId)
        : undefined;
      const reference: ItemReference = {
        id: found.id,
        key,
        title: found.title,
        href: project ? paths.item(slug, project.key, key) : undefined,
        typeName: type.name,
        status: external
          ? {
              label: link?.externalKey
                ? `${link.externalStatus ?? "Status unavailable"} in ${tool.name}`
                : `Not handed off to ${tool.name}`,
              category: project
                ? deliveryCategory(found, project, delivery, link)
                : undefined,
            }
          : {
              label: status?.name ?? "Unknown status",
              category: status?.category,
              color: status?.color,
            },
        refinement: type.hasSpecification ? found.refinementState : null,
        readiness:
          type.hasSpecification && found.readinessTotal > 0
            ? {
                passed: found.readinessPassed,
                total: found.readinessTotal,
                blocked: found.blockingThreads > 0,
              }
            : null,
        owner: external
          ? link?.externalAssignee?.trim()
            ? link.externalAssignee.trim()
            : null
          : found.assigneeId
            ? memberName(found.assigneeId)
            : null,
        iteration: iteration
          ? iterationLabel(iteration, project?.iterationMode)
          : null,
        archived: Boolean(found.archivedAt),
      };
      resolved.set(id, reference);
      return reference;
    };
    const page = (id: string): PageReference | undefined => {
      const found = index?.pageById.get(id);
      const space = found ? index?.spaceById.get(found.spaceId) : undefined;
      if (!found || !space || !index) return undefined;
      return {
        id: found.id,
        title: found.title,
        href: paths.spacePage(slug, space.slug, found.id),
        space,
        path: ancestorsOf(index.pageById, found.id).map((p) => p.title),
        publishedCommitId: found.publishedCommitId,
        publishedAt: found.updatedAt,
        publishedBy: found.publishedById
          ? memberName(found.publishedById)
          : null,
        archived: Boolean(found.archivedAt ?? space.archivedAt),
      };
    };
    let itemList: ReturnType<Resolver["items"]> | undefined;
    let pageList: ReturnType<Resolver["pages"]> | undefined;
    return {
      item,
      page,
      items: () =>
        (itemList ??= items.map((i) => ({
          id: i.id,
          key: keyOf(i),
          title: i.title,
          archived: Boolean(i.archivedAt),
        }))),
      pages: () =>
        (pageList ??= index
          ? [...index.pageById.values()].map((p) => {
              const space = index.spaceById.get(p.spaceId);
              return {
                id: p.id,
                title: p.title,
                space: space?.name ?? "",
                publishedCommitId: p.publishedCommitId,
                archived: Boolean(p.archivedAt ?? space?.archivedAt),
              };
            })
          : []),
      organizationId,
    };
  }, [
    items,
    projects,
    delivery,
    directory,
    entities,
    memberName,
    slug,
    index,
    organizationId,
  ]);
}

/**
 * Resolves references for everything below it once (chips re-render when
 * items or pages change, never the documents around them). Optional: a chip
 * outside it resolves on its own.
 */
export function ReferencesProvider({ children }: { children: ReactNode }) {
  const value = useResolverValue();
  return (
    <ResolverContext.Provider value={value}>
      {children}
    </ResolverContext.Provider>
  );
}

function useOwnResolver(enabled: boolean) {
  // Hooks run unconditionally; without a provider this one does the work.
  const own = useResolverValue();
  return enabled ? own : empty;
}

export function useReferences(): Resolver {
  const provided = useContext(ResolverContext);
  const own = useOwnResolver(!provided);
  return provided ?? own;
}

/**
 * A recorded decision from the open item's history (already synchronized),
 * or undefined: elsewhere the chip shows its stored label and the card asks
 * the server.
 */
export function useLocalDecision(id: string): DecisionReference | undefined {
  const item = useContext(ItemContext);
  const resolver = useReferences();
  return useMemo(() => {
    const decision = item?.entities.find(
      (e) => e.type === "decision" && e.id === id,
    );
    if (decision?.type !== "decision") return undefined;
    const revision = item?.entities.find(
      (e) => e.type === "revision" && e.id === decision.revisionId,
    );
    const owner = resolver.item(decision.workItemId);
    return {
      id: decision.id,
      title: decision.title,
      itemKey: owner?.key ?? null,
      itemHref: owner?.href ?? null,
      revisionNumber: revision?.type === "revision" ? revision.number : null,
    };
  }, [item?.entities, id, resolver]);
}
