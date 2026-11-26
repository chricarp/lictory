import { useCallback, type ReactNode } from "react";
import { Factory, GitPullRequest } from "lucide-react";
import {
  sessionTitle,
  waitsForRunner,
  type AgentEntity,
  type SessionEntity,
} from "@lictory/core/factory/entities";
import { identifier, relativeTime } from "@lictory/core/lib/work-items";
import { cn } from "@lictory/core/lib/utils";
import { Tooltip } from "@lictory/ui/tooltip";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useLiveClaims } from "@lictory/platform/components/claims/claims";
import {
  Actor,
  AgentActor,
  AgentAvatar,
  PolicyActor,
} from "@lictory/platform/components/identity/actor";
import {
  PageHeader,
  PageLinkTabs,
} from "@lictory/platform/components/shell/page-header";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import { sessionState } from "@lictory/platform/lib/session-state";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { useFactory } from "@lictory/platform/components/factory/store";
import { activeStatuses } from "@lictory/platform/components/factory/labels";
import {
  formatDuration,
  sessionDuration,
} from "@lictory/platform/components/factory/overview-blocks";

// Pieces shared by the Factory's pages: the page frame (one header with the
// Factory's tabs), who started a session, its state and its row.

export function FactoryPage({
  meta,
  description,
  actions,
  children,
}: {
  // One quiet line of counts in the header: "2 running · 1 queued".
  meta?: ReactNode;
  // What the page is for, behind the header's info button.
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { organization } = useWorkspace();
  const org = organization.slug;
  const tabs = (
    <PageLinkTabs
      label="Factory"
      tabs={[
        {
          href: factoryPaths.overview(org),
          label: "Overview",
          exact: true,
        },
        { href: factoryPaths.sessions(org), label: "Sessions", exact: true },
        { href: factoryPaths.agents(org), label: "Agents" },
        { href: factoryPaths.runners(org), label: "Runners" },
      ]}
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Factory"
        icon={<Factory />}
        description={description}
        meta={meta}
        tabs={<div className="max-sm:hidden">{tabs}</div>}
        actions={actions}
        // New agent, Add runner: on phones the page's create replaces the
        // shell's "+".
        ownCreate={!!actions}
      />
      {/* Phones: the header keeps the title; the tabs get their own row. */}
      <div className="flex h-10 shrink-0 items-center border-b px-2 sm:hidden">
        {tabs}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pt-6 pb-16 sm:px-8">
          {children}
        </div>
      </div>
    </div>
  );
}

// Who started a session: the person, or "Build policy (set by Ada)" for a
// session an autonomy policy started (its owner stays accountable).
export function SessionStarter({
  session,
  size = 16,
}: {
  session: Pick<SessionEntity, "requestedById" | "startedByPolicy">;
  size?: 16 | 20;
}) {
  return session.startedByPolicy ? (
    <PolicyActor
      level={session.startedByPolicy.level}
      setById={session.startedByPolicy.setById}
      size={size}
    />
  ) : (
    <Actor userId={session.requestedById} size={size} label="first" />
  );
}

// Who answers the agent: "you" when it is me (I started the session or own
// the agent), else the person who started it.
export function useDecider() {
  const { userId, memberName } = useWorkspace();
  return useCallback(
    (session: SessionEntity, agent: AgentEntity | undefined) =>
      session.requestedById === userId || agent?.ownerId === userId
        ? "you"
        : memberName(session.requestedById),
    [userId, memberName],
  );
}

// A session's state with its claim and who it waits on, from the shared
// vocabulary (lib/session-state): "Waiting on you", "Running".
export function useSessionStateOf() {
  const claims = useLiveClaims();
  const decider = useDecider();
  const { runners } = useFactory();
  return useCallback(
    (session: SessionEntity, agent: AgentEntity | undefined) =>
      sessionState(session, {
        claim: session.workItemId ? claims.get(session.workItemId) : null,
        decider: decider(session, agent),
        noRunner: waitsForRunner(session, agent, runners),
      }),
    [claims, decider, runners],
  );
}

// The work item a session works on, as its key ("PAY-6").
export function useItemKey() {
  const { items, projects } = useWorkspace();
  return useCallback(
    (workItemId: string | null) => {
      if (!workItemId) return undefined;
      const item = items.find((i) => i.id === workItemId);
      const project = item
        ? projects.find((p) => p.id === item.projectId)
        : undefined;
      return item && project ? identifier(project, item.number) : undefined;
    },
    [items, projects],
  );
}

// A session's title without the item key its row already shows
// ("PAY-6: Refund retries" beside PAY-6 reads "Refund retries").
export function titleBeside(title: string, key: string | undefined) {
  const text = sessionTitle(title);
  return key && text.startsWith(`${key}: `) ? text.slice(key.length + 2) : text;
}

// A line of someone else's text (an agent's error) ended once, so copy can
// follow it: "…already exists." + " Open it to retry.", never "exists..".
export function asSentence(text: string) {
  const trimmed = text.trim();
  return /[.!?…:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// What a finished session changed, in one line: its summary or why it
// failed, and its pull request.
export function sessionOutcome(
  session: Pick<
    SessionEntity,
    "status" | "resultSummary" | "error" | "pullRequestId" | "pullRequestUrl"
  >,
) {
  const firstLine = (text: string | null) =>
    text?.split("\n").find((line) => line.trim()) ?? null;
  if (session.status === "failed")
    return firstLine(session.error) ?? "It failed without saying why.";
  if (session.status === "canceled") return "Canceled before it finished.";
  return firstLine(session.resultSummary) ?? "No summary from the agent.";
}

// One session in a list: the agent, the item key and title, who started it
// (or what it changed, once finished), its state and when it last moved.
// As a `log` row (the Sessions tab) every row has the same shape whatever its
// state: who ran it, who started it, how long it ran and, once finished,
// what came of it; its time is when it started, the list's order.
export function SessionRow({
  session,
  agent,
  showOutcome = false,
  log = false,
}: {
  session: SessionEntity;
  agent: AgentEntity | undefined;
  showOutcome?: boolean;
  log?: boolean;
}) {
  const { organization } = useWorkspace();
  const stateOf = useSessionStateOf();
  const itemKey = useItemKey();
  const pullRequest = Boolean(session.pullRequestId ?? session.pullRequestUrl);
  const key = itemKey(session.workItemId);
  const finished = !activeStatuses.includes(session.status);
  const ran = sessionDuration(session);
  if (log)
    return (
      <ListRow
        className="max-sm:[&>time]:hidden"
        href={factoryPaths.session(organization.slug, session.id)}
        leading={agent ? <AgentAvatar agent={agent} size={20} /> : undefined}
        identifier={key}
        title={titleBeside(session.title, key)}
        meta={
          <>
            <AgentActor
              agent={agent}
              ownerId={agent?.ownerId}
              avatar={false}
              className="shrink-0"
            />
            <span className="flex shrink-0 items-center gap-1">
              by <SessionStarter session={session} />
            </span>
            {ran !== null && (
              <span className="shrink-0 tabular-nums">
                {finished ? "ran " : "running "}
                {formatDuration(ran)}
              </span>
            )}
            {finished && (
              <span className="min-w-0 truncate">
                {sessionOutcome(session)}
              </span>
            )}
            {pullRequest && (
              <span className="flex shrink-0 items-center gap-1">
                <GitPullRequest aria-hidden className="size-3" />
                Pull request
              </span>
            )}
          </>
        }
        chips={<SessionStateChip state={stateOf(session, agent)} />}
        time={{
          iso: session.createdAt,
          label: `Started ${relativeTime(session.createdAt)}`,
        }}
      />
    );
  return (
    <ListRow
      // Phones keep the title: the time gives way.
      className="max-sm:[&>time]:hidden"
      href={factoryPaths.session(organization.slug, session.id)}
      leading={agent ? <AgentAvatar agent={agent} size={20} /> : undefined}
      identifier={key}
      title={titleBeside(session.title, key)}
      meta={
        showOutcome ? (
          <>
            <span className="min-w-0 truncate">{sessionOutcome(session)}</span>
            {pullRequest && (
              <span className="flex shrink-0 items-center gap-1">
                <GitPullRequest aria-hidden className="size-3" />
                Pull request
              </span>
            )}
          </>
        ) : (
          <>
            <AgentActor
              agent={agent}
              ownerId={agent?.ownerId}
              avatar={false}
              className="shrink-0"
            />
            <span className="flex shrink-0 items-center gap-1">
              started by <SessionStarter session={session} />
            </span>
          </>
        )
      }
      chips={<SessionStateChip state={stateOf(session, agent)} />}
      time={session.completedAt ?? session.updatedAt}
    />
  );
}

// A long identifier (a branch) cut in the middle, so its distinctive end
// stays: "lictory/pay-10-refund-b…6ecca6ae". The whole text is on hover and
// is what assistive technology reads.
export function MiddleTruncate({
  text,
  tail = 10,
  className,
}: {
  text: string;
  // Characters always shown at the end.
  tail?: number;
  className?: string;
}) {
  const cut = text.length > tail * 2 ? text.length - tail : text.length;
  return (
    <Tooltip label={text}>
      <span className={cn("flex min-w-0", className)}>
        <span className="min-w-0 truncate">{text.slice(0, cut)}</span>
        {cut < text.length && (
          <span className="shrink-0">{text.slice(cut)}</span>
        )}
      </span>
    </Tooltip>
  );
}
