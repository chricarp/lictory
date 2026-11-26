import { useMemo, useSyncExternalStore } from "react";
import {
  CircleCheckBig,
  CircleDot,
  CircleX,
  FileText,
  FolderKanban,
  History,
  House,
  Inbox,
} from "lucide-react";
import { sessionTitle } from "@lictory/core/factory/entities";
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
import { useSessionUser } from "@lictory/platform/lib/session";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useShell } from "@lictory/platform/components/workspace/shell";
import {
  WaitingRowView,
  useWaitingOnYou,
} from "@lictory/platform/components/workspace/inbox";
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
  inFlight,
  OUTCOME_DAYS,
  readyToStart,
  recentOutcomes,
  recentPages,
} from "@lictory/platform/components/shell/home/derive";
import { useClaimability } from "@lictory/platform/components/claims/claims";
import { useFactory } from "@lictory/platform/components/factory/store";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { AgentAvatar } from "@lictory/platform/components/identity/actor";

const SHOWN = 6;
// Home summarizes the queue; the Inbox's To do is the whole list.
const WAITING_SHOWN = 3;

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
    isAdmin,
  } = useWorkspace();
  const { project } = useShell();
  const waiting = useWaitingOnYou();
  const claimability = useClaimability();
  const { sessions, agentById } = useFactory();
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
    () =>
      readyToStart(
        { ...context, startable: (item) => claimability(item).claimable },
        SHOWN,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projects, delivery, links, userId, claimability],
  );
  // The window is days, so the current hour is precise enough: a stable
  // snapshot of the clock, recomputed with synchronized changes.
  const hour = useSyncExternalStore(noSubscribe, currentHour, () => 0);
  const outcomes = useMemo(
    () =>
      recentOutcomes(
        {
          ...context,
          sessions,
          agentOwner: (id) => agentById.get(id)?.ownerId,
          now: hour * HOUR,
        },
        SHOWN,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projects, delivery, links, userId, sessions, agentById, hour],
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
  // Setting the factory up is an administrator's job; a member's Home is
  // their work.
  const showSetup = isAdmin && setup.ready && !setup.complete;
  const outsideProjects =
    !isAdmin && !directory.projectMembers.some((m) => m.userId === userId);
  const firstName = (user.name || "").split(" ")[0];
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Home"
        icon={<House />}
        // Creating work is the sidebar's (and C, anywhere); Home repeats
        // no second entry point.
        actions={<LittoLauncher />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-12 sm:px-6 lg:px-8 lg:pt-8">
          <div className="mb-6">
            <p className="text-lg font-semibold tracking-[-0.01em]">
              <Greeting />
              {firstName ? `, ${firstName}` : ""}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {summary(waiting.length, flight.total, ready.total)}
            </p>
          </div>
          {showSetup && (
            <div className="mb-4">
              <SetupChecklist setup={setup} />
            </div>
          )}
          {outsideProjects && (
            <div className="mb-4">
              <Panel
                title="You’re not in a project yet"
                icon={<FolderKanban />}
                empty={`An administrator of ${organization.name} adds you to a project and gives you a discipline there (Product, Engineering, QA) so you can write and review its specifications. Until then you can read and talk in channels and spaces.`}
              />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Panel
                title="Waiting on you"
                icon={<Inbox />}
                count={waiting.length}
                more={{
                  label:
                    waiting.length > WAITING_SHOWN
                      ? `All ${waiting.length} in Inbox`
                      : "Open Inbox",
                  href: paths.inbox(org, "todo"),
                }}
                // A new organization's Home is its setup, not empty boxes.
                empty={
                  showSetup
                    ? undefined
                    : "Nothing waits on you. Review requests, questions from agents and pull requests to merge appear here."
                }
              >
                {waiting.slice(0, WAITING_SHOWN).map((row) => (
                  <WaitingRowView key={row.key} row={row} />
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
                // The same rule as the project's Factory queue.
                more={
                  project?.deliveryMode === "native"
                    ? {
                        label: "Factory queue",
                        href: paths.factoryQueue(org, project.key),
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
              <Panel
                title="Recent outcomes"
                icon={<History />}
                count={outcomes.total}
                actions={
                  <span className="text-xs text-muted-foreground">
                    Last {OUTCOME_DAYS} days
                  </span>
                }
              >
                {outcomes.rows.map((outcome) => {
                  if (outcome.kind === "item")
                    return (
                      <ItemRow
                        key={outcome.key}
                        item={outcome.item}
                        project={projectById.get(outcome.item.projectId)}
                        links={links}
                      />
                    );
                  const { session, failed } = outcome;
                  const agent = agentById.get(session.agentId);
                  return (
                    <ListRow
                      key={outcome.key}
                      href={factoryPaths.session(org, session.id)}
                      leading={
                        failed ? (
                          <CircleX
                            aria-hidden
                            className="size-4 text-destructive"
                          />
                        ) : agent ? (
                          <AgentAvatar agent={agent} size={20} />
                        ) : undefined
                      }
                      title={
                        <>
                          <span className="sr-only">
                            {failed ? "Failed" : "Finished"} ·{" "}
                          </span>
                          {sessionTitle(session.title)}
                        </>
                      }
                      meta={
                        <>
                          <span
                            className={
                              failed
                                ? "shrink-0 font-medium text-destructive"
                                : "shrink-0 font-medium text-foreground/80"
                            }
                          >
                            {failed ? "Failed" : "Finished"}
                          </span>
                          <span aria-hidden>·</span>
                          <span className="truncate">
                            {failed
                              ? `${agent?.name ?? "The agent"} stopped${session.error ? `: ${session.error}` : ""}. Open it to retry.`
                              : session.pullRequestId
                                ? `${agent?.name ?? "The agent"} opened a pull request`
                                : `${agent?.name ?? "The agent"} reported its result`}
                          </span>
                        </>
                      }
                      time={outcome.at}
                    />
                  );
                })}
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
const HOUR = 3_600_000;
const currentHour = () => Math.floor(Date.now() / HOUR);

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
