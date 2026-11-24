import { useMemo, useSyncExternalStore } from "react";
import {
  CircleCheckBig,
  CircleDot,
  FileText,
  House,
  Inbox,
  SquarePen,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  statusOf,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  deliveryCategory,
  externalLinksByItem,
} from "@lictory/core/lib/lifecycle";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Kbd } from "@lictory/ui/primitives";
import { useSessionUser } from "@lictory/platform/lib/session";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { useAttention } from "@lictory/platform/components/workspace/inbox";
import { usePageAttention } from "@lictory/platform/components/knowledge/page-attention";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import { StatusIcon } from "@lictory/platform/components/items/status";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { Onboarding } from "@lictory/platform/components/workspace/onboarding";
import {
  SyncIssue,
  isSyncBlocked,
} from "@lictory/platform/components/workspace/sync-issue";
import { LittoLauncher } from "@lictory/platform/components/intelligence/dock/launcher";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { homeCards } from "@lictory/platform/components/shell/nav-registry";
import { HomeCardBoundary } from "@lictory/platform/components/shell/home/panel";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import {
  SetupChecklist,
  useSetup,
} from "@lictory/platform/components/shell/home/setup-checklist";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";
import {
  inFlight,
  readyToStart,
  recentPages,
} from "@lictory/platform/components/shell/home/derive";

const SHOWN = 6;

// The organization's index. A brand-new organization without projects first
// creates its first project; afterwards Home is the person's factory floor.
export function HomeRoute() {
  const { projects, view, isAdmin } = useWorkspace();
  if (projects.length > 0) return <Home />;
  if (view.status === "hydrating") return null;
  if (isSyncBlocked(view.status))
    return <SyncIssue status={view.status} error={view.error} />;
  return <Onboarding canCreate={isAdmin} />;
}

// What waits on me, what I have in flight, what is ready to start, what
// changed in the spaces, and what the factory registers (agent sessions,
// questions). Everything comes from synchronized state: no polling.
function Home() {
  const user = useSessionUser();
  const {
    organization,
    items,
    projects,
    delivery,
    directory,
    view,
    userId,
    capabilitiesIn,
  } = useWorkspace();
  const { openCreate, project } = useShell();
  const attention = useAttention();
  const pages = usePageAttention();
  const { index } = useSpaces();
  const links = useMemo(
    () =>
      externalLinksByItem(
        Object.values(view.entities),
        directory.delivery.targets,
      ),
    [view.entities, directory.delivery.targets],
  );
  const context = { items, projects, delivery, links, userId };
  const flight = useMemo(
    () => inFlight(context, SHOWN),
    // `context` is rebuilt from these each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projects, delivery, links, userId],
  );
  const ready = useMemo(
    () => readyToStart(context, SHOWN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projects, delivery, links, userId],
  );
  const recent = useMemo(() => {
    const active = new Set(
      index.spaces.filter((s) => !s.archivedAt).map((s) => s.id),
    );
    return recentPages(index.pageById.values(), active, SHOWN);
  }, [index]);
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const org = organization.slug;
  const setup = useSetup();
  const factory = useFactory();
  // What agents ask me counts as waiting on me, like reviews and approvals.
  const agentAsks = waitingOnMe(
    factory.sessions,
    factory.agentById,
    userId,
  ).reduce((n, s) => n + s.approvals.length, 0);
  const waitingTotal = attention.length + pages.length;
  const showSetup = setup.ready && !setup.complete;
  const capabilities = capabilitiesIn(project?.id);
  const canCreate =
    !!project &&
    (capabilities.editSpecifications || capabilities.changeProperties);
  const firstName = (user.name || "").split(" ")[0];
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Home"
        icon={<House />}
        actions={
          <>
            {canCreate && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openCreate()}
                className="max-sm:hidden"
              >
                <SquarePen className="size-3.5" aria-hidden />
                New item
                <Kbd>C</Kbd>
              </Button>
            )}
            <LittoLauncher />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
          <div className="mb-6">
            <p className="text-lg font-semibold tracking-[-0.01em]">
              <Greeting />
              {firstName ? `, ${firstName}` : ""}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {summary(waitingTotal + agentAsks, flight.total, ready.total)}
            </p>
          </div>
          {showSetup && (
            <div className="mb-4">
              <SetupChecklist setup={setup} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Panel
                title="Waiting on you"
                icon={<Inbox />}
                count={waitingTotal}
                more={{
                  label: "Open Inbox",
                  href: `${paths.inbox(org)}?view=todo`,
                }}
                // A new organization's Home is its setup, not empty boxes.
                empty={
                  showSetup
                    ? undefined
                    : "Nothing waits on you. Review requests, approvals and pull requests to merge appear here."
                }
              >
                {attention.slice(0, SHOWN).map((entry) => {
                  const p = projectById.get(entry.item.projectId);
                  return (
                    <ItemRow
                      key={`${entry.item.id}-${entry.reason}`}
                      item={entry.item}
                      project={p}
                      reason={`${entry.reason} · ${entry.detail}`}
                      reasonIcon={entry.icon}
                    />
                  );
                })}
                {pages
                  .slice(0, Math.max(0, SHOWN - attention.length))
                  .map((entry) => (
                    <ListRow
                      key={entry.pullRequest.id}
                      href={`${paths.spacePage(org, entry.space.slug, entry.page.id)}/history?view=pulls&pr=${entry.pullRequest.id}`}
                      leading={
                        <FileText className="size-4 text-muted-foreground" />
                      }
                      title={entry.page.title}
                      meta={`${pageReason[entry.reason]} · ${entry.space.name}`}
                      time={entry.pullRequest.updatedAt}
                    />
                  ))}
              </Panel>
              <Panel
                title="In flight"
                icon={<CircleDot />}
                count={flight.total}
              >
                {flight.rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    project={projectById.get(item.projectId)}
                    links={links}
                  />
                ))}
              </Panel>
              <Panel
                title="Ready to start"
                icon={<CircleCheckBig />}
                count={ready.total}
                more={
                  project
                    ? {
                        label: "All ready work",
                        href: paths.view(org, project.key, "ready"),
                      }
                    : undefined
                }
              >
                {ready.rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    project={projectById.get(item.projectId)}
                    reason={
                      item.assigneeId === userId
                        ? "Assigned to you"
                        : "Unassigned"
                    }
                  />
                ))}
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {homeCards.map(({ id, label, Card }) => (
                <HomeCardBoundary key={id} name={label}>
                  <Card />
                </HomeCardBoundary>
              ))}
              <Panel
                title="Recently edited pages"
                icon={<FileText />}
                count={recent.total}
                more={{ label: "All spaces", href: paths.spaces(org) }}
              >
                {recent.rows.map((page) => {
                  const space = index.spaceById.get(page.spaceId);
                  if (!space) return null;
                  return (
                    <ListRow
                      key={page.id}
                      href={paths.spacePage(org, space.slug, page.id)}
                      leading={
                        <FileText className="size-4 text-muted-foreground" />
                      }
                      title={page.title || "Untitled"}
                      meta={space.name}
                      time={page.updatedAt}
                    />
                  );
                })}
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const pageReason = {
  review_requested: "Review requested on a page change",
  review_again: "Review again: the page change was updated",
  changes_requested: "Changes requested on your page change",
  ready_to_merge: "Ready to merge",
} as const;

function summary(waiting: number, flight: number, ready: number) {
  const parts = [
    waiting && `${waiting} waiting on you`,
    flight && `${flight} in flight`,
    ready && `${ready} ready to start`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "You are all caught up.";
}

function ItemRow({
  item,
  project,
  reason,
  reasonIcon,
  links,
}: {
  item: WorkItem;
  project: Project | undefined;
  reason?: string;
  reasonIcon?: React.ReactNode;
  links?: ReturnType<typeof externalLinksByItem>;
}) {
  const { organization, delivery } = useWorkspace();
  const id = identifier(project, item.number);
  const status = statusOf(delivery, item);
  return (
    <ListRow
      href={paths.item(organization.slug, project?.key ?? "", id)}
      leading={reasonIcon ?? <TypeIcon type={typeOf(delivery, item)} />}
      identifier={id}
      title={item.title}
      meta={
        reason ??
        (project && (
          <>
            <StatusIcon
              category={deliveryCategory(
                item,
                project,
                delivery,
                links?.get(item.id),
              )}
              color={
                project.deliveryMode === "external" ? undefined : status?.color
              }
            />
            {project.deliveryMode === "external"
              ? (links?.get(item.id)?.externalStatus ?? "In progress")
              : (status?.name ?? "Started")}
            <span aria-hidden>·</span>
            <span className="truncate">{project.name}</span>
          </>
        ))
      }
      time={item.updatedAt}
    />
  );
}

const noSubscribe = () => () => undefined;

// Good morning / afternoon / evening, in the person's own time.
function Greeting() {
  const hour = useSyncExternalStore(
    noSubscribe,
    () => new Date().getHours(),
    () => 12,
  );
  return hour < 5
    ? "Good evening"
    : hour < 12
      ? "Good morning"
      : hour < 18
        ? "Good afternoon"
        : "Good evening";
}
