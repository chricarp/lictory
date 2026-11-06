import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { FileText } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { identifier, refinementMeta } from "@lictory/core/lib/work-items";
import type {
  WorkflowStatus,
  WorkItem,
} from "@lictory/core/contracts/protocol";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";

// Live references inside page content. A work item mention shows the item
// as I can see it now (identifier, status, refinement, readiness); a page
// link shows the page's current title. What I cannot read shows no more
// than the content itself already says: the stored key, or "Unavailable
// page" without a title.

type References = {
  item: (id: string) => WorkItem | undefined;
  itemKey: (item: WorkItem) => string;
  itemHref: (item: WorkItem) => string | undefined;
  status: (statusId: string) => WorkflowStatus | undefined;
  page: (id: string) => { title: string; href: string } | undefined;
};
const ReferencesContext = createContext<References | null>(null);

// Re-renders only the reference node views (context consumers) when items
// or pages change, never the editor around them.
export function ReferencesProvider({ children }: { children: ReactNode }) {
  const { items, projects, organization, delivery } = useWorkspace();
  const { index } = useSpaces();
  const value = useMemo<References>(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    return {
      item: (id) => itemById.get(id),
      itemKey: (item) =>
        identifier(projectById.get(item.projectId), item.number),
      itemHref: (item) => {
        const project = projectById.get(item.projectId);
        return project
          ? paths.item(
              organization.slug,
              project.key,
              identifier(project, item.number),
            )
          : undefined;
      },
      status: (statusId) => delivery.statuses.get(statusId),
      page: (id) => {
        const page = index.pageById.get(id);
        const space = page ? index.spaceById.get(page.spaceId) : undefined;
        if (!page || !space) return undefined;
        return {
          title: page.title,
          href: paths.spacePage(organization.slug, space.slug, page.id),
        };
      },
    };
  }, [items, projects, organization.slug, delivery.statuses, index]);
  return (
    <ReferencesContext.Provider value={value}>
      {children}
    </ReferencesContext.Provider>
  );
}

function useReferences() {
  const value = useContext(ReferencesContext);
  if (!value) throw new Error("References need ReferencesProvider.");
  return value;
}

export function WorkItemReference({ node }: ReactNodeViewProps) {
  const refs = useReferences();
  const workItemId = node.attrs.workItemId as string | null;
  const storedKey = (node.attrs.key as string | null) ?? "Work item";
  const item = workItemId ? refs.item(workItemId) : undefined;
  if (!item)
    return (
      <NodeViewWrapper
        as="span"
        className="page-ref page-ref-plain"
        data-type="workItemRef"
      >
        {storedKey}
      </NodeViewWrapper>
    );
  const key = refs.itemKey(item);
  const status = refs.status(item.statusId);
  const href = refs.itemHref(item);
  const refinement = item.refinementState;
  const readiness =
    refinement && item.readinessTotal > 0
      ? `${item.readinessPassed}/${item.readinessTotal}`
      : null;
  // Read after the visible key and title (the name starts with what is
  // shown, WCAG 2.5.3); the glyphs are described in words.
  const details = [
    status && `status ${status.name}`,
    refinement && `refinement ${refinementMeta[refinement].label}`,
    readiness &&
      `readiness ${item.readinessPassed} of ${item.readinessTotal} checks`,
  ]
    .filter(Boolean)
    .join(", ");
  const label = `${key} ${item.title}${details ? `, ${details}` : ""}`;
  const content = (
    <>
      <StatusIcon category={status?.category} color={status?.color} />
      <span className="font-mono text-[12px] tabular-nums">{key}</span>
      <span className="page-ref-title">{item.title}</span>
      {refinement && <RefinementIcon state={refinement} className="size-3" />}
      {readiness && (
        <span
          aria-hidden
          className="text-[11px] text-muted-foreground tabular-nums"
        >
          {readiness}
        </span>
      )}
      {details && <span className="sr-only">, {details}</span>}
    </>
  );
  return (
    <NodeViewWrapper
      as="span"
      className="page-ref"
      data-type="workItemRef"
      data-key={key}
    >
      {href ? (
        <Link href={href} title={label}>
          {content}
        </Link>
      ) : (
        <span title={label}>{content}</span>
      )}
    </NodeViewWrapper>
  );
}

export function PageReference({ node }: ReactNodeViewProps) {
  const refs = useReferences();
  const pageId = node.attrs.pageId as string | null;
  const page = pageId ? refs.page(pageId) : undefined;
  return (
    <NodeViewWrapper
      as="span"
      className={page ? "page-ref page-link" : "page-ref page-ref-plain"}
      data-type="pageRef"
    >
      {page ? (
        <Link href={page.href}>
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="page-ref-title">{page.title}</span>
        </Link>
      ) : (
        "Unavailable page"
      )}
    </NodeViewWrapper>
  );
}
