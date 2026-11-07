import { useMemo } from "react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  deliveryCategory,
  externalLinksByItem,
  type ExternalLink,
} from "@lictory/core/lib/lifecycle";
import {
  identifier,
  refinementMeta,
  statusOf,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import type {
  StatusCategory,
  WorkItem,
} from "@lictory/core/contracts/protocol";
import { Avatar } from "@lictory/ui/primitives";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  RefinementIcon,
  StatusIcon,
} from "@lictory/platform/components/items/status";
import { estimateLabel } from "@lictory/platform/components/delivery/card";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";

// Work items as pages show them (the "Work on this page" panel and work list
// blocks): read-only rows with the facts their delivery owner keeps. Only
// items synchronized to this person appear; everything else is left out,
// without a placeholder or a count.

export type WorkFact = {
  item: WorkItem;
  project: Project | undefined;
  key: string;
  href: string | undefined;
  // Delivery status as its owner states it: the native workflow status, or
  // the delivery tool's status read back in external projects.
  status: {
    // Short ("In Progress"), and complete ("In Progress in Jira").
    label: string;
    description: string;
    category: StatusCategory | undefined;
  };
  closed: boolean;
};

export function useWorkFacts() {
  const { items, projects, delivery, organization, view, directory } =
    useWorkspace();
  const links = useMemo(
    () =>
      externalLinksByItem(
        Object.values(view.entities),
        directory.delivery.targets,
      ),
    [view.entities, directory.delivery.targets],
  );
  return useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const fact = (item: WorkItem): WorkFact => {
      const project = projectById.get(item.projectId);
      const key = identifier(project, item.number);
      let status: WorkFact["status"];
      if (project?.deliveryMode === "external") {
        const link: ExternalLink | undefined = links.get(item.id);
        const tool = projectDeliveryTool(directory, project.id).name;
        const label = link?.externalKey
          ? (link.externalStatus ?? "Status unavailable")
          : "Not handed off";
        status = {
          label,
          description: link?.externalKey
            ? `${label} in ${tool}`
            : `Not handed off to ${tool}`,
          category: deliveryCategory(item, project, delivery, link),
        };
      } else {
        const native = statusOf(delivery, item);
        status = {
          label: native?.name ?? "No status",
          description: native?.name ?? "No status",
          category: native?.category,
        };
      }
      return {
        item,
        project,
        key,
        href: project
          ? paths.item(organization.slug, project.key, key)
          : undefined,
        status,
        closed: status.category === "done",
      };
    };
    return {
      // Visible, active items only.
      get: (id: string) => {
        const item = itemById.get(id);
        return item && !item.archivedAt ? fact(item) : undefined;
      },
      all: items.filter((i) => !i.archivedAt),
      fact,
      projectById,
    };
  }, [items, projects, delivery, organization.slug, links, directory]);
}

// "3 of 5 done": canceled work counts toward neither number.
export function rollup(facts: readonly WorkFact[]) {
  const counted = facts.filter((f) => f.status.category !== "canceled");
  return {
    total: counted.length,
    done: counted.filter((f) => f.closed).length,
  };
}

export function WorkRow({
  fact,
  detail,
  showOwner = false,
  compact = false,
}: {
  fact: WorkFact;
  // What links the item to the page ("Mentioned", "Created here"…).
  detail?: string;
  showOwner?: boolean;
  compact?: boolean;
}) {
  const { memberName, delivery } = useWorkspace();
  const { item, project, key, href, status } = fact;
  const type = typeOf(delivery, item);
  const estimate =
    project?.deliveryMode === "external"
      ? null
      : estimateLabel(project, item.estimate);
  const refinement =
    type.hasSpecification && item.refinementState ? item.refinementState : null;
  const owner =
    showOwner && project?.deliveryMode !== "external" && item.assigneeId
      ? memberName(item.assigneeId)
      : null;
  const native = project?.deliveryMode !== "external";
  return (
    <li
      className={cn(
        "group/row flex min-w-0 items-center gap-2.5 rounded-lg px-2 text-[13px] hover:bg-muted/60 has-focus-visible:bg-muted/60",
        compact ? "py-1" : "py-1.5",
      )}
      data-work-row={key}
    >
      <span title={status.description} className="inline-flex">
        <StatusIcon
          category={status.category}
          color={native ? statusOf(delivery, item)?.color : undefined}
        />
      </span>
      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {key}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {href ? (
          <Link
            href={href}
            className="font-medium outline-none hover:underline focus-visible:underline"
          >
            {item.title}
          </Link>
        ) : (
          <span className="font-medium">{item.title}</span>
        )}
        {detail && (
          <span aria-hidden className="ml-2 text-xs text-muted-foreground">
            {detail}
          </span>
        )}
        <span className="sr-only">
          , {native ? `status ${status.label}` : status.description}
          {refinement && `, ${refinementMeta[refinement].label}`}
          {estimate && `, estimate ${estimate}`}
          {owner && `, assigned to ${owner}`}
          {detail && `, ${detail}`}
        </span>
      </span>
      <span
        aria-hidden
        className="hidden w-28 shrink-0 items-center gap-1.5 truncate text-xs text-muted-foreground md:inline-flex"
        title={status.description}
      >
        <span className="truncate">{status.label}</span>
      </span>
      {refinement ? (
        <span
          aria-hidden
          title={`Refinement: ${refinementMeta[refinement].label}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <RefinementIcon state={refinement} />
          <span className="hidden lg:inline">
            {refinementMeta[refinement].label}
          </span>
        </span>
      ) : null}
      {estimate !== null && (
        <span
          aria-hidden
          title="Estimate"
          className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
        >
          {estimate}
        </span>
      )}
      {owner && (
        <span aria-hidden className="shrink-0">
          <Avatar name={owner} userId={item.assigneeId} size="xs" />
        </span>
      )}
    </li>
  );
}
