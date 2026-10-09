"use client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  KanbanSquare,
  Loader2,
  RefreshCw,
  Send,
  Upload,
} from "lucide-react";
import { callCapability } from "~/capabilities/client";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  identifier,
  relativeTime,
  segmentOf,
  typeOf,
  type Project,
} from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Badge, EmptyState } from "~/components/ui/primitives";
import { MissingState } from "~/components/ui/status-page";
import { LoadingState } from "~/components/ui/spinner";
import { TypeIcon } from "~/components/items/icons";
import { RefinementIcon } from "~/components/items/status";
import { useWorkspace } from "~/components/workspace/provider";
import { useProject } from "~/components/workspace/project-gate";
import { useShell } from "~/components/workspace/shell";
import {
  ExportDialog,
  ExternalStatusBadge,
  exportAvailability,
  type ExternalLink,
} from "./export";

// External projects deliver in Jira. The hand-off replaces the board: what is
// ready to hand off, what changed since, what Jira reports back and what needs
// attention.
export function Handoff() {
  const project = useProject();
  const { organization } = useWorkspace();
  if (project.deliveryMode !== "external")
    return (
      <MissingState
        illustration="planning"
        icon={KanbanSquare}
        title={`${project.name} delivers in Lictory`}
        action={
          <Link
            href={paths.board(organization.slug, project.key)}
            className="contents"
          >
            <Button variant="secondary">Open board</Button>
          </Link>
        }
      >
        Ready work moves across the project&apos;s board and backlog; nothing is
        handed off to an external tool.
      </MissingState>
    );
  return <ExternalHandoff project={project} />;
}

type Row = { item: WorkItem; link?: ExternalLink };

function ExternalHandoff({ project }: { project: Project }) {
  const {
    items,
    view,
    directory,
    delivery,
    organization,
    capabilitiesIn,
    canManage,
  } = useWorkspace();
  const { toast } = useShell();
  const availability = exportAvailability(
    directory,
    project,
    capabilitiesIn(project.id).publishDelivery,
  );
  const canHandOff = availability.configured && availability.allowed;
  const groups = useMemo(() => {
    const links = new Map<string, ExternalLink>();
    for (const e of Object.values(view.entities))
      if (e.type === "externalLink" && e.projectId === project.id) {
        const current = links.get(e.workItemId);
        // The project's current Jira connection wins over older links.
        if (
          !current ||
          (e.connectionId === availability.connection?.id &&
            current.connectionId !== e.connectionId)
        )
          links.set(e.workItemId, e);
      }
    const ready: (Row & { changed: boolean })[] = [];
    const inJira: Row[] = [];
    const attention: Row[] = [];
    const refining: WorkItem[] = [];
    for (const item of items) {
      if (item.projectId !== project.id || item.archivedAt) continue;
      const link = links.get(item.id);
      const spec = typeOf(delivery, item).hasSpecification;
      if (
        link &&
        (link.status === "failed" ||
          link.status === "conflict" ||
          link.lastError)
      ) {
        attention.push({ item, link });
        continue;
      }
      if (link && (link.externalKey || link.status === "pending"))
        inJira.push({ item, link });
      if (!spec) continue;
      const changed = Boolean(
        link?.externalKey &&
        link.publishedRevisionNumber != null &&
        link.publishedRevisionNumber < item.revisionNumber,
      );
      if (item.refinementState === "ready") {
        if (link?.status === "pending") continue;
        if (!link?.externalKey || changed) ready.push({ item, link, changed });
      } else if (!link?.externalKey) refining.push(item);
    }
    const recent = (a: Row, b: Row) =>
      b.item.updatedAt.localeCompare(a.item.updatedAt);
    return {
      ready: ready.sort(recent),
      inJira: inJira.sort(
        (a, b) =>
          (b.link?.syncedAt ?? "").localeCompare(a.link?.syncedAt ?? "") ||
          recent(a, b),
      ),
      attention: attention.sort(recent),
      refining: refining.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }, [items, view.entities, project.id, delivery, availability.connection?.id]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<
    { item: WorkItem } | { itemIds: string[] }
  >();
  const [refreshing, setRefreshing] = useState(false);
  const readyIds = new Set(groups.ready.map((r) => r.item.id));
  const chosen = [...selected].filter((id) => readyIds.has(id));
  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await callCapability<{
        refreshed: number;
        failedConnections: number;
      }>("refreshDeliveryStatus", {
        organizationId: organization.id,
        projectId: project.id,
      });
      toast(
        result.failedConnections
          ? `Jira could not be reached. ${result.refreshed} issue${result.refreshed === 1 ? "" : "s"} refreshed; check the Jira connection in organization settings.`
          : `${result.refreshed} issue${result.refreshed === 1 ? "" : "s"} refreshed from Jira.`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Jira could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  };
  const label = (item: WorkItem) => identifier(project, item.number);
  const href = (item: WorkItem) =>
    paths.item(
      organization.slug,
      project.key,
      segmentOf(typeOf(delivery, item)),
      label(item),
    );
  const loading = view.status === "hydrating" && items.length === 0;
  const jiraKey = availability.target?.externalProjectKey;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {project.name} · Hand-off
          </h1>
          {jiraKey && (
            <span className="text-xs text-muted-foreground">
              to {jiraKey}
              {availability.connection && ` on ${availability.connection.name}`}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {availability.target && (
              <Button
                variant="ghost"
                size="sm"
                disabled={refreshing}
                onClick={() => void refresh()}
                title="Read the current status and assignee of every handed-off issue. Nothing is written to Jira."
              >
                <RefreshCw
                  className={cn("size-3.5", refreshing && "animate-spin")}
                />
                Refresh from Jira
              </Button>
            )}
            {canHandOff && (
              <Button
                size="sm"
                disabled={!chosen.length}
                onClick={() => setExporting({ itemIds: chosen })}
              >
                <Upload className="size-3.5" />
                {chosen.length
                  ? `Hand off ${chosen.length} ${chosen.length === 1 ? "item" : "items"}`
                  : "Hand off"}
              </Button>
            )}
          </div>
        </header>
        {!availability.target ? (
          <Notice tone="warning">
            {project.name} has no Jira project to hand work off to yet.{" "}
            {canManage(project.id) ? (
              <Link
                className="underline"
                href={paths.projectSettings(
                  organization.slug,
                  project.key,
                  "delivery",
                )}
              >
                Choose a Jira project in delivery settings
              </Link>
            ) : (
              "Ask a project administrator to choose one in the project's delivery settings"
            )}
            .
          </Notice>
        ) : !availability.connection ? (
          <Notice tone="warning">
            The Jira connection of this project is unavailable. An organization
            administrator can reconnect it in organization settings.
          </Notice>
        ) : (
          availability.connection.status === "invalid" && (
            <Notice tone="warning">
              {availability.connection.name} rejected Lictory&apos;s credentials
              {availability.connection.lastError
                ? `: ${availability.connection.lastError}`
                : ""}
              . An organization administrator can reconnect it.
            </Notice>
          )
        )}
        {availability.configured && !availability.allowed && (
          <p className="text-[13px] text-muted-foreground">
            Your disciplines in {project.name} cannot hand off work. People with
            the hand-off capability export ready specifications here.
          </p>
        )}
        {loading ? (
          <LoadingState label="Opening hand-off" />
        ) : (
          <>
            {groups.attention.length > 0 && (
              <Group
                title="Needs attention"
                count={groups.attention.length}
                tone="danger"
              >
                {groups.attention.map(({ item, link }) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    label={label(item)}
                    href={href(item)}
                    meta={
                      <>
                        {link?.status === "conflict" ? (
                          <Badge tone="warning">Changed in Jira</Badge>
                        ) : (
                          <Badge tone="danger">Failed</Badge>
                        )}
                        {link && <JiraKey link={link} />}
                      </>
                    }
                    detail={
                      link?.lastError ??
                      (link?.status === "conflict"
                        ? "Jira was edited since the last hand-off. Review and confirm overwriting to hand off again."
                        : undefined)
                    }
                    action={
                      canHandOff && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setExporting({ itemIds: [item.id] })}
                        >
                          Retry
                        </Button>
                      )
                    }
                  />
                ))}
              </Group>
            )}
            <Group title="Ready to hand off" count={groups.ready.length}>
              {groups.ready.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted-foreground">
                  Nothing is waiting. Specifications appear here once their
                  readiness checks pass.
                </p>
              ) : (
                groups.ready.map(({ item, link, changed }) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    label={label(item)}
                    href={href(item)}
                    select={
                      canHandOff
                        ? {
                            checked: selected.has(item.id),
                            onChange: (on) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (on) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              }),
                          }
                        : undefined
                    }
                    meta={
                      changed && link ? (
                        <>
                          <Badge tone="warning">Changed since hand-off</Badge>
                          <JiraKey link={link} />
                        </>
                      ) : (
                        <Badge tone="info">Not handed off</Badge>
                      )
                    }
                    detail={
                      changed && link
                        ? `Handed off revision ${link.publishedRevisionNumber} · current ${item.revisionNumber}`
                        : `Revision ${item.revisionNumber} · ${item.readinessPassed}/${item.readinessTotal} checks pass`
                    }
                    action={
                      canHandOff && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setExporting({ item })}
                        >
                          <Upload className="size-3.5" />
                          {changed ? "Hand off changes" : "Hand off"}
                        </Button>
                      )
                    }
                  />
                ))
              )}
            </Group>
            <Group title="In Jira" count={groups.inJira.length}>
              {groups.inJira.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted-foreground">
                  Nothing has been handed off yet.
                </p>
              ) : (
                groups.inJira.map(({ item, link }) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    label={label(item)}
                    href={href(item)}
                    meta={
                      link && (
                        <>
                          {link.status === "pending" ? (
                            <Badge>
                              <Loader2 className="size-3 animate-spin" />
                              Exporting…
                            </Badge>
                          ) : (
                            <ExternalStatusBadge link={link} />
                          )}
                          <JiraKey link={link} />
                        </>
                      )
                    }
                    detail={link && jiraDetail(link, item)}
                  />
                ))
              )}
            </Group>
            {groups.refining.length > 0 && (
              <details className="group rounded-xl bg-card shadow-(--shadow-border)">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
                  <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                  Still in refinement
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {groups.refining.length}
                  </span>
                </summary>
                <ul className="border-t">
                  {groups.refining.map((item) => (
                    <li key={item.id}>
                      <ItemRow
                        item={item}
                        label={label(item)}
                        href={href(item)}
                        meta={
                          item.refinementState && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <RefinementIcon state={item.refinementState} />
                              {item.readinessPassed}/{item.readinessTotal}
                            </span>
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!groups.ready.length &&
              !groups.inJira.length &&
              !groups.attention.length &&
              !groups.refining.length && (
                <EmptyState
                  illustration="planning"
                  title="No specifications yet"
                >
                  Create Epics and Stories in {project.name}; once they are
                  reviewed and ready they can be handed off to Jira from here.
                </EmptyState>
              )}
          </>
        )}
      </div>
      {exporting && (
        <ExportDialog
          {...exporting}
          onClose={() => {
            setExporting(undefined);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function jiraDetail(link: ExternalLink, item: WorkItem) {
  const parts = [
    link.externalAssignee
      ? `Assignee ${link.externalAssignee}`
      : link.externalStatus
        ? "Unassigned in Jira"
        : undefined,
    link.publishedRevisionNumber != null
      ? link.publishedRevisionNumber < item.revisionNumber
        ? `Revision ${link.publishedRevisionNumber} handed off · current ${item.revisionNumber}`
        : `Revision ${link.publishedRevisionNumber} handed off`
      : "Linked, not exported",
    link.syncedAt ? `checked ${relativeTime(link.syncedAt)}` : undefined,
  ];
  return parts.filter(Boolean).join(" · ");
}

function Notice({ tone, children }: { tone: "warning"; children: ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]",
        tone === "warning" &&
          "bg-amber-500/10 text-amber-900 dark:text-amber-200",
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Group({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-xl bg-card shadow-(--shadow-border)",
        tone === "danger" && "ring-1 ring-destructive/30",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {tone === "danger" ? (
          <AlertTriangle className="size-3.5 text-destructive" />
        ) : (
          <Send className="size-3.5 text-muted-foreground" />
        )}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      <div className="divide-y border-t">{children}</div>
    </section>
  );
}

function JiraKey({ link }: { link: ExternalLink }) {
  if (!link.externalKey) return null;
  return link.externalUrl ? (
    <a
      href={link.externalUrl}
      target="_blank"
      rel="noreferrer"
      className="relative z-10 inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {link.externalKey}
      <ArrowUpRight className="size-3" />
    </a>
  ) : (
    <span className="font-mono text-xs text-muted-foreground">
      {link.externalKey}
    </span>
  );
}

function ItemRow({
  item,
  label,
  href,
  meta,
  detail,
  action,
  select,
}: {
  item: WorkItem;
  label: string;
  href: string;
  meta?: ReactNode;
  detail?: string;
  action?: ReactNode;
  select?: { checked: boolean; onChange: (checked: boolean) => void };
}) {
  const { delivery } = useWorkspace();
  return (
    <div className="relative flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-muted/50">
      {select && (
        <input
          type="checkbox"
          aria-label={`Select ${label}`}
          checked={select.checked}
          onChange={(e) => select.onChange(e.target.checked)}
          className="relative z-10"
        />
      )}
      <TypeIcon type={typeOf(delivery, item)} />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate after:absolute after:inset-0"
        >
          {item.title}
        </Link>
        {detail && (
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
      {meta && (
        <span className="flex shrink-0 items-center gap-1.5">{meta}</span>
      )}
      {action && <span className="relative z-10 shrink-0">{action}</span>}
    </div>
  );
}
