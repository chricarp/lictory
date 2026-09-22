"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  GitCompareArrows,
  Link2,
  MoreHorizontal,
  PanelRight,
  X,
} from "lucide-react";
import { paths } from "~/lib/paths";
import { identifier, type Project } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { Badge, SectionLabel } from "~/components/ui/primitives";
import { useItemEngine, useWorkspace } from "~/components/workspace/provider";
import { IssueIdentifier } from "./identifier";
import { KindIcon } from "./icons";
import { Presence } from "./presence";
import { IssueStatus } from "./status";
import { AssigneePicker, IssuePriority, ParentPicker } from "./properties";
import {
  LabelChip,
  LabelPicker,
  MilestoneBadge,
  MilestonePicker,
} from "./labels";
import { ItemContext, useItemContextValue } from "./item-context";
import { Specification } from "./specification";
import { EpicStories } from "./epic-stories";
import { InlineTitle } from "./inline-title";
import { Discussions } from "~/components/review/threads";
import { Suggestions } from "~/components/review/suggestions";
import { ReviewPanel } from "~/components/review/review-panel";
import { Readiness } from "~/components/review/readiness";
import { Activity } from "~/components/review/activity";
import { RevisionPanel, CompareRevisions } from "~/components/review/revisions";
import { diffStats } from "./diff";

export type DetailMode =
  | { kind: "read" }
  | { kind: "edit" }
  | { kind: "suggest" }
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
  const searchParams = useSearchParams();
  const itemEngine = useItemEngine(item.id, item.projectId, !pendingCreate);
  // While creation is still queued the organization store already holds the
  // optimistic item and its first revision; the item engine opens afterwards.
  const entities = itemEngine.engine
    ? itemEngine.entities
    : Object.values(workspace.view.entities);
  const ctx = useItemContextValue({
    item,
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
  const [mode, setMode] = useState<DetailMode>({ kind: "read" });
  const [panelOpen, setPanelOpen] = useState(false);
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
    item.kind === "epic" ? "epics" : "stories",
    searchParams,
  );
  const update = (patch: {
    status?: WorkItem["status"];
    priority?: WorkItem["priority"];
    assigneeId?: string | null;
    parentId?: string | null;
    milestoneId?: string | null;
    labelIds?: string[];
  }) =>
    void ctx.mutate({ type: "updateWorkItem", workItemId: item.id, ...patch });
  const failing = ctx.readiness?.checks.filter((c) => !c.passed) ?? [];
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
          status={item.status}
          onChange={canChange ? (status) => update({ status }) : undefined}
          readyHint={
            failing.length
              ? `${failing.length} check${failing.length > 1 ? "s" : ""} failing`
              : undefined
          }
        />
      </Property>
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
      {item.kind !== "epic" && (
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
      <ReviewPanel />
      <Readiness />
      <RevisionPanel
        onCompare={(from, to) => setMode({ kind: "compare", from, to })}
      />
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
              {item.kind === "epic" ? "Epics" : "Stories"}
            </Link>
            {parent && (
              <>
                <ChevronRight className="size-3.5 shrink-0" />
                <Link
                  href={paths.item(
                    workspace.organization.slug,
                    project.key,
                    "epics",
                    identifier(project, parent.number),
                  )}
                  className="flex min-w-0 items-center gap-1 hover:text-foreground"
                  title={parent.title}
                >
                  <KindIcon kind="epic" />
                  <span className="truncate">{parent.title}</span>
                </Link>
              </>
            )}
            <ChevronRight className="size-3.5 shrink-0" />
            <KindIcon kind={item.kind} />
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
                    <span className="text-emerald-700">
                      +{changedSinceSeen.added}
                    </span>{" "}
                    <span className="text-red-700">
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
                  status={item.status}
                  onChange={
                    canChange ? (status) => update({ status }) : undefined
                  }
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
                ) : (
                  <Specification
                    mode={mode.kind}
                    setMode={(kind) => setMode({ kind })}
                    onQuote={(quote, section) => setDraft({ quote, section })}
                  />
                )}
              </div>
              {item.kind === "epic" && (
                <section className="mt-10">
                  <EpicStories />
                </section>
              )}
              <section className="mt-10">
                <Suggestions />
              </section>
              <section className="mt-10">
                <Discussions draft={draft} onDraftChange={setDraft} />
              </section>
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
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
