"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  GitCompareArrows,
  Link2,
  MoreHorizontal,
  PanelRight,
  Upload,
  X,
} from "lucide-react";
import { paths } from "~/lib/paths";
import { track } from "~/lib/analytics/client";
import {
  identifier,
  isTopLevel,
  refinementMeta,
  segmentOf,
  typeOf,
  type Project,
} from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import { useItemEngine, useWorkspace } from "~/components/workspace/provider";
import { IssueIdentifier } from "./identifier";
import { TypeIcon } from "./icons";
import { Presence } from "./presence";
import { WatchButton } from "~/components/notifications/watch-button";
import { IssueStatus, RefinementStatus } from "./status";
import {
  EstimatePicker,
  IterationPicker,
  Relations,
  TeamPicker,
  TypePicker,
} from "./delivery-properties";
import { AssigneePicker, IssuePriority, ParentPicker } from "./properties";
import {
  LabelChip,
  LabelPicker,
  MilestoneBadge,
  MilestonePicker,
} from "./labels";
import { ItemContext, useItemContextValue } from "./item-context";
import { Specification } from "./specification";
import { Attachments } from "./attachments";
import { EpicStories } from "./epic-stories";
import { InlineTitle } from "./inline-title";
import { Discussions } from "~/components/review/threads";
import { Suggestions } from "~/components/review/suggestions";
import { SuggestionView } from "~/components/review/suggestion-view";
import { ReviewPanel } from "~/components/review/review-panel";
import { Readiness } from "~/components/review/readiness";
import { Activity } from "~/components/review/activity";
import { RevisionPanel, CompareRevisions } from "~/components/review/revisions";
import { diffStats } from "./diff";
import {
  ExportDialog,
  ExternalDelivery,
  useExportAvailability,
} from "~/components/delivery/export";

export type DetailMode =
  | { kind: "read" }
  | { kind: "edit" }
  | { kind: "suggest" }
  | { kind: "suggestion"; id: string }
  | { kind: "compare"; from: string; to: string };

const seenKey = (id: string) => `lictory:seen:${id}`;

export function ItemDetail({
  item,
  project,
  pendingCreate,
}: {
  item: WorkItem;
  project: Project;
  pendingCreate: boolean;
}) {
  const workspace = useWorkspace();
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    const key = `${workspace.organization.id}:${item.id}`;
    if (lastOpened.current === key) return;
    lastOpened.current = key;
    track("work_item_opened", {
      organization_id: workspace.organization.id,
      project_id: item.projectId,
      work_item_id: item.id,
      team_id: item.teamId,
      type_id: item.typeId,
    });
  }, [
    workspace.organization.id,
    item.id,
    item.projectId,
    item.teamId,
    item.typeId,
  ]);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const itemEngine = useItemEngine(item.id, item.projectId, !pendingCreate);
  // While creation is still queued the organization store already holds the
  // optimistic item and its first revision; the item engine opens afterwards.
  const entities = itemEngine.engine
    ? itemEngine.entities
    : Object.values(workspace.view.entities);
  const type = typeOf(workspace.delivery, item);
  const team = workspace.delivery.teams.get(item.teamId);
  const ctx = useItemContextValue({
    item,
    type,
    project,
    entities,
    view: itemEngine.engine ? itemEngine.view : workspace.view,
    userId: workspace.userId,
    roleIds: workspace.roleIds,
    memberName: workspace.memberName,
    roleName: workspace.roleName,
    capabilities: workspace.capabilities,
    mutate: itemEngine.engine ? itemEngine.mutate : workspace.mutate,
  });
  // A suggestion under review is linkable: `?suggestion=<id>` opens it.
  const [mode, setModeState] = useState<DetailMode>(() => {
    const id = searchParams.get("suggestion");
    return id ? { kind: "suggestion", id } : { kind: "read" };
  });
  const setMode = useCallback(
    (next: DetailMode) => {
      track("specification_mode_selected", {
        organization_id: workspace.organization.id,
        project_id: item.projectId,
        work_item_id: item.id,
        mode: next.kind,
      });
      setModeState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next.kind === "suggestion") params.set("suggestion", next.id);
      else params.delete("suggestion");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [
      pathname,
      router,
      searchParams,
      workspace.organization.id,
      item.projectId,
      item.id,
    ],
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportAvailability = useExportAvailability(item);
  // Export is offered for ready specifications; teams delivering in an
  // external tool get it as a header action, others find it in the menu.
  const canExport =
    type.hasSpecification &&
    exportAvailability.configured &&
    exportAvailability.allowed &&
    !item.archivedAt;
  const [draft, setDraft] = useState<{
    quote?: string;
    section: string;
  } | null>(null);
  // Revision the user saw on their previous visit (this browser). Written back
  // on every confirmed revision so the banner is about what changed meanwhile.
  const [lastSeen, setLastSeen] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : localStorage.getItem(seenKey(item.id)),
  );
  const current = ctx.current;
  // First visit: the baseline is whatever revision was current when the page
  // opened, so edits that land while the reviewer is reading are surfaced too.
  if (!lastSeen && current && !current.id.startsWith("pending:"))
    setLastSeen(current.id);
  useEffect(() => {
    if (!current || current.id.startsWith("pending:")) return;
    localStorage.setItem(seenKey(item.id), current.id);
  }, [item.id, current]);
  // Baseline for "what changed": my most recent approval when it is newer than
  // the revision I last looked at, otherwise that revision.
  const seenRevision = useMemo(() => {
    const seen = lastSeen
      ? ctx.revisions.find((r) => r.id === lastSeen)
      : undefined;
    const approved = ctx.approvals
      .filter((a) => a.reviewerId === workspace.userId)
      .map((a) => ctx.revisions.find((r) => r.id === a.revisionId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.number - a.number)[0];
    return approved && (!seen || approved.number > seen.number)
      ? approved
      : seen;
  }, [lastSeen, ctx.revisions, ctx.approvals, workspace.userId]);
  const changedSinceSeen = useMemo(() => {
    if (!seenRevision || !current || seenRevision.id === current.id)
      return undefined;
    if (current.authorId === workspace.userId) return undefined;
    return {
      ...diffStats(seenRevision.content, current.content),
      from: seenRevision,
      to: current,
    };
  }, [seenRevision, current, workspace.userId]);
  const parent = item.parentId
    ? workspace.items.find((i) => i.id === item.parentId)
    : undefined;
  const listHref = paths.list(
    workspace.organization.slug,
    project.key,
    segmentOf(type),
    searchParams,
  );
  const update = (
    patch: Omit<
      Extract<Parameters<typeof ctx.mutate>[0], { type: "updateWorkItem" }>,
      "type" | "workItemId"
    >,
  ) =>
    void ctx.mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  const failing = ctx.readiness?.checks.filter((c) => !c.passed) ?? [];
  // Readiness policy of the team, surfaced next to started statuses.
  const startHint =
    type.hasSpecification &&
    item.refinementState !== "ready" &&
    team &&
    team.readinessPolicy !== "off"
      ? team.readinessPolicy === "block"
        ? "Blocked until the specification is ready"
        : "Specification not ready yet"
      : undefined;
  // Without the "change properties" capability the panel is informative only;
  // the server rejects the command regardless of what the UI renders.
  const canChange = ctx.canChangeProperties;
  const milestone = workspace.milestones.find((m) => m.id === item.milestoneId);
  const itemLabels = workspace.labels.filter((l) =>
    item.labelIds.includes(l.id),
  );
  const properties = (
    <div className="space-y-1">
      <Property label="Status">
        <IssueStatus
          teamId={item.teamId}
          statusId={item.statusId}
          onChange={canChange ? (statusId) => update({ statusId }) : undefined}
          hint={startHint}
        />
      </Property>
      {item.refinementState && (
        <Property label="Refinement">
          <RefinementStatus
            state={item.refinementState}
            onChange={
              canChange
                ? (refinementState) => update({ refinementState })
                : undefined
            }
            readyHint={
              item.refinementState === "ready"
                ? "Every readiness check passes."
                : failing.length
                  ? `${failing.length} readiness check${failing.length > 1 ? "s" : ""} failing. ${refinementMeta.ready.label} is set automatically when they pass.`
                  : undefined
            }
          />
        </Property>
      )}
      <Property label="Type">
        <TypePicker
          item={item}
          onChange={canChange ? (typeId) => update({ typeId }) : undefined}
        />
      </Property>
      <Property label="Team">
        <TeamPicker
          teamId={item.teamId}
          onChange={canChange ? (teamId) => update({ teamId }) : undefined}
        />
      </Property>
      {team && team.iterationMode !== "off" && (
        <Property
          label={team.iterationMode === "automatic" ? "Cycle" : "Sprint"}
        >
          <IterationPicker
            item={item}
            onChange={
              canChange ? (iterationId) => update({ iterationId }) : undefined
            }
          />
        </Property>
      )}
      {team && team.estimateScale !== "none" && (
        <Property label="Estimate">
          <EstimatePicker
            item={item}
            onChange={
              canChange ? (estimate) => update({ estimate }) : undefined
            }
          />
        </Property>
      )}
      <Property label="Priority">
        <IssuePriority
          priority={item.priority}
          onChange={canChange ? (priority) => update({ priority }) : undefined}
        />
      </Property>
      <Property label="Owner">
        <AssigneePicker
          assigneeId={item.assigneeId}
          onChange={
            canChange ? (assigneeId) => update({ assigneeId }) : undefined
          }
        />
      </Property>
      {type.level === 1 && (
        <Property label="Epic">
          {canChange ? (
            <ParentPicker
              parentId={item.parentId}
              projectId={item.projectId}
              project={project}
              onChange={(parentId) => update({ parentId })}
            />
          ) : (
            <span className="truncate px-1.5 text-[13px]">
              {parent
                ? `${identifier(project, parent.number)} ${parent.title}`
                : "No epic"}
            </span>
          )}
        </Property>
      )}
      <Property label="Milestone">
        {canChange ? (
          <MilestonePicker
            projectId={item.projectId}
            milestoneId={item.milestoneId}
            onChange={(milestoneId) => update({ milestoneId })}
          />
        ) : milestone ? (
          <MilestoneBadge milestone={milestone} />
        ) : (
          <span className="px-1.5 text-[13px] text-muted-foreground">None</span>
        )}
      </Property>
      <Property label="Labels">
        {canChange ? (
          <LabelPicker
            projectId={item.projectId}
            labelIds={item.labelIds}
            onChange={(labelIds) => update({ labelIds })}
          />
        ) : itemLabels.length ? (
          <div className="flex flex-wrap gap-1">
            {itemLabels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        ) : (
          <span className="px-1.5 text-[13px] text-muted-foreground">None</span>
        )}
      </Property>
    </div>
  );
  const panel = (
    <div className="space-y-6 p-4">
      <section>
        <SectionLabel className="mb-2">Properties</SectionLabel>
        {properties}
      </section>
      {type.hasSpecification && <ExternalDelivery item={item} />}
      {ctx.reviewable ? (
        <>
          <ReviewPanel />
          <Readiness />
          <RevisionPanel
            onCompare={(from, to) => setMode({ kind: "compare", from, to })}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {type.name} items are plain work: no reviews or readiness checks.
          Change the type to one with a specification to refine it.
        </p>
      )}
    </div>
  );
  return (
    <ItemContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <header className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3 text-[13px]">
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1 text-muted-foreground"
          >
            <Link href={listHref} className="shrink-0 hover:text-foreground">
              {isTopLevel(type) ? "Epics" : "Work items"}
            </Link>
            {parent && (
              <>
                <ChevronRight className="size-3.5 shrink-0" />
                <Link
                  href={paths.item(
                    workspace.organization.slug,
                    project.key,
                    segmentOf(typeOf(workspace.delivery, parent)),
                    identifier(project, parent.number),
                  )}
                  className="flex min-w-0 items-center gap-1 hover:text-foreground"
                  title={parent.title}
                >
                  <TypeIcon type={typeOf(workspace.delivery, parent)} />
                  <span className="truncate">{parent.title}</span>
                </Link>
              </>
            )}
            <ChevronRight className="size-3.5 shrink-0" />
            <TypeIcon type={type} />
            <IssueIdentifier
              project={project}
              number={item.number}
              copyable
              className="text-foreground"
            />
          </nav>
          {item.archivedAt && <Badge tone="warning">Archived</Badge>}
          {!pendingCreate && <Presence itemId={item.id} />}
          <div className="ml-auto flex items-center gap-1">
            {mode.kind === "compare" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMode({ kind: "read" })}
              >
                <X className="size-3.5" /> Close comparison
              </Button>
            ) : (
              ctx.revisions.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Compare revisions"
                  onClick={() =>
                    setMode({
                      kind: "compare",
                      from: (changedSinceSeen?.from ?? ctx.revisions[1])!.id,
                      to: current!.id,
                    })
                  }
                >
                  <GitCompareArrows className="size-3.5" /> Changes
                </Button>
              )
            )}
            {canExport && exportAvailability.external && (
              <Button
                variant="secondary"
                size="sm"
                disabled={item.refinementState !== "ready"}
                title={
                  item.refinementState === "ready"
                    ? `Export to ${exportAvailability.connection?.name ?? "Jira"}`
                    : "Only ready items can be exported."
                }
                onClick={() => setExporting(true)}
              >
                <Upload className="size-3.5" /> Export to Jira
              </Button>
            )}
            {!pendingCreate && (
              <WatchButton
                organizationId={workspace.organization.id}
                workItemId={item.id}
                involved={
                  item.createdById === workspace.userId ||
                  item.assigneeId === workspace.userId ||
                  ctx.messages.some((m) => m.authorId === workspace.userId) ||
                  ctx.suggestions.some((x) => x.authorId === workspace.userId)
                }
              />
            )}
            <Popover
              width={200}
              align="end"
              trigger={(props) => (
                <Button
                  {...props}
                  variant="ghost"
                  size="icon"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              )}
            >
              {(close) => (
                <div className="p-1">
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(
                        window.location.href,
                      );
                      close();
                    }}
                  >
                    <Link2 className="size-3.5 text-muted-foreground" /> Copy
                    link
                  </button>
                  {canExport && !exportAvailability.external && (
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50"
                      disabled={item.refinementState !== "ready"}
                      title={
                        item.refinementState === "ready"
                          ? undefined
                          : "Only ready items can be exported."
                      }
                      onClick={() => {
                        close();
                        setExporting(true);
                      }}
                    >
                      <Upload className="size-3.5 text-muted-foreground" />
                      Export to Jira…
                    </button>
                  )}
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:opacity-50"
                    disabled={!workspace.capabilities.changeProperties}
                    title={
                      workspace.capabilities.changeProperties
                        ? undefined
                        : "Your roles cannot archive or restore items."
                    }
                    onClick={() => {
                      close();
                      void ctx.mutate({
                        type: "archiveWorkItem",
                        workItemId: item.id,
                        archived: !item.archivedAt,
                      });
                    }}
                  >
                    {item.archivedAt ? (
                      <ArchiveRestore className="size-3.5 text-muted-foreground" />
                    ) : (
                      <Archive className="size-3.5 text-muted-foreground" />
                    )}
                    {item.archivedAt ? "Restore" : "Archive"}
                  </button>
                </div>
              )}
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="xl:hidden"
              aria-label="Details"
              onClick={() => setPanelOpen(true)}
            >
              <PanelRight className="size-4" />
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-6 py-6 lg:px-10">
              {changedSinceSeen && mode.kind !== "compare" && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[13px]">
                  <GitCompareArrows className="size-4 text-primary" />
                  <span>
                    Changed since you last looked: revision{" "}
                    {changedSinceSeen.from.number} →{" "}
                    {changedSinceSeen.to.number}
                    {" · "}
                    <span className="text-success">
                      +{changedSinceSeen.added}
                    </span>{" "}
                    <span className="text-destructive">
                      −{changedSinceSeen.removed}
                    </span>{" "}
                    lines
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() =>
                      setMode({
                        kind: "compare",
                        from: changedSinceSeen.from.id,
                        to: changedSinceSeen.to.id,
                      })
                    }
                  >
                    View changes
                  </Button>
                </div>
              )}
              <InlineTitle />
              <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 xl:hidden">
                <IssueStatus
                  teamId={item.teamId}
                  statusId={item.statusId}
                  onChange={
                    canChange ? (statusId) => update({ statusId }) : undefined
                  }
                  hint={startHint}
                />
                <IssuePriority
                  priority={item.priority}
                  onChange={
                    canChange ? (priority) => update({ priority }) : undefined
                  }
                />
                <AssigneePicker
                  assigneeId={item.assigneeId}
                  onChange={
                    canChange
                      ? (assigneeId) => update({ assigneeId })
                      : undefined
                  }
                />
              </div>
              <div className="mt-6">
                {mode.kind === "compare" ? (
                  <CompareRevisions
                    from={mode.from}
                    to={mode.to}
                    onChange={(from, to) =>
                      setMode({ kind: "compare", from, to })
                    }
                  />
                ) : mode.kind === "suggestion" ? (
                  <SuggestionView
                    suggestionId={mode.id}
                    onClose={() => setMode({ kind: "read" })}
                  />
                ) : (
                  <Specification
                    mode={mode.kind}
                    setMode={(kind) => setMode({ kind })}
                    onQuote={(quote, section) => setDraft({ quote, section })}
                    onSuggestionCreated={(id) =>
                      setMode({ kind: "suggestion", id })
                    }
                  />
                )}
              </div>
              {mode.kind !== "suggestion" && (
                <>
                  <section className="mt-10">
                    <EpicStories />
                  </section>
                  <section className="mt-10">
                    <Relations item={item} canChange={canChange} />
                  </section>
                  {ctx.reviewable && (
                    <section className="mt-10">
                      <Suggestions
                        onOpen={(id) => setMode({ kind: "suggestion", id })}
                      />
                    </section>
                  )}
                  <section className="mt-10">
                    <Discussions draft={draft} onDraftChange={setDraft} />
                  </section>
                </>
              )}
              {!pendingCreate && (
                <Attachments
                  context={{
                    organizationId: item.organizationId,
                    workItemId: item.id,
                  }}
                  userId={workspace.userId}
                />
              )}
              <section className="mt-10 mb-10">
                <Activity />
              </section>
            </div>
          </div>
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-muted/20 xl:block">
            {panel}
          </aside>
          {panelOpen && (
            <div className="fixed inset-0 z-40 xl:hidden">
              <button
                aria-label="Close details"
                className="absolute inset-0 bg-black/30"
                onClick={() => setPanelOpen(false)}
              />
              <aside className="absolute inset-y-0 right-0 w-[min(360px,90vw)] overflow-y-auto border-l bg-background shadow-xl">
                <div className="flex h-11 items-center justify-between border-b px-4 text-sm font-medium">
                  Details
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    onClick={() => setPanelOpen(false)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                {panel}
              </aside>
            </div>
          )}
        </div>
      </div>
      {exporting && (
        <ExportDialog item={item} onClose={() => setExporting(false)} />
      )}
    </ItemContext.Provider>
  );
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-[13px]">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
