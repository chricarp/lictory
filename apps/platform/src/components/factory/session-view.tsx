import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CircleStop,
  GitBranch,
  GitPullRequest,
  Hand,
  RotateCcw,
  Server,
  SquareTerminal,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { agentSession } from "@lictory/core/contracts/state-machines";
import { sessionTitle } from "@lictory/core/factory/entities";
import { cn } from "@lictory/core/lib/utils";
import {
  absoluteTime,
  identifier,
  relativeTime,
} from "@lictory/core/lib/work-items";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { toast } from "@lictory/ui/toast";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import {
  ApprovalRequest,
  canDecide,
} from "@lictory/platform/components/shell/approval-request";
import { AgentActor } from "@lictory/platform/components/identity/actor";
import { Composer } from "@lictory/platform/components/channels/composer";
import { harnessLabel } from "@lictory/platform/components/factory/labels";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  SessionStarter,
  useSessionStateOf,
} from "@lictory/platform/components/factory/parts";
import {
  useFactory,
  useSession,
  useSessionEvents,
} from "@lictory/platform/components/factory/store";
import {
  TranscriptRow,
  transcriptItems,
} from "@lictory/platform/components/factory/transcript";

// One agent session, read like a coding agent's transcript: the header
// says what it is and where it stands (back, title, state, Interrupt,
// Cancel, Retry), one line says who and where (the agent via its owner,
// the harness, the runner, the item, the branch, when it started), the
// event log fills in live, a banner holds what the agent asks while it
// waits on a person, and the shared composer steers it.

// Events are synchronized in windows; "Show earlier" widens the window.
const WINDOW = 200;
const MAX_WINDOW = 2000;

export function SessionView() {
  const { session: sessionId = "" } = useParams<{ session: string }>();
  const { organization, userId, isAdmin, memberName, items, projects } =
    useWorkspace();
  const { agentById, runnerById } = useFactory();
  const { session, complete } = useSession(sessionId);
  const stateOf = useSessionStateOf();
  const [limit, setLimit] = useState(WINDOW);
  const { events } = useSessionEvents(sessionId, limit);
  const org = organization.slug;
  const transcript = useMemo(() => transcriptItems(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const back = {
    label: "Back to the Factory",
    href: factoryPaths.overview(org),
  };

  // Follow new events while the reader is at the bottom.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [transcript.length, session?.approvals.length]);

  if (!session)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Session" back={back} />
        {complete ? (
          <EmptyState title="This session does not exist">
            It may belong to another organization.{" "}
            <Link href={back.href} className="underline">
              Back to the Factory
            </Link>
          </EmptyState>
        ) : (
          <LoadingState label="Loading the session" />
        )}
      </div>
    );

  const agent = agentById.get(session.agentId);
  const runner = session.runnerId
    ? runnerById.get(session.runnerId)
    : undefined;
  const steer = canDecide(session, agent, userId);
  const item = session.workItemId
    ? items.find((i) => i.id === session.workItemId)
    : undefined;
  const project = item
    ? projects.find((p) => p.id === item.projectId)
    : undefined;
  const allows = (step: Parameters<typeof agentSession.allows>[1]) =>
    agentSession.allows(session.status, step);
  const act = (name: string, label: string) => async () => {
    try {
      await callCapability(name, {
        organizationId: organization.id,
        sessionId: session.id,
      });
    } catch (error) {
      toast({
        type: "error",
        title: `${label} failed`,
        description: (error as Error).message,
      });
    }
  };
  const truncated =
    events.length >= limit && limit < MAX_WINDOW && events[0]?.sequence !== 1;
  const state = stateOf(session, agent);
  const asks = session.status === "waiting" ? session.approvals : [];
  const itemKey = item && project ? identifier(project, item.number) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={back}
        title={sessionTitle(session.title)}
        actions={
          <>
            <SessionStateChip state={state} className="max-sm:hidden" />
            {steer && allows("interrupt") && (
              <Button
                variant="secondary"
                aria-label="Interrupt"
                onClick={act("interruptAgentSession", "Interrupting")}
              >
                <Hand className="size-3.5" aria-hidden />
                <span className="max-md:hidden">Interrupt</span>
              </Button>
            )}
            {(steer || isAdmin) && allows("cancel") && (
              <Button
                variant="secondary"
                aria-label="Cancel"
                onClick={act("cancelAgentSession", "Canceling")}
              >
                <CircleStop className="size-3.5" aria-hidden />
                <span className="max-md:hidden">Cancel</span>
              </Button>
            )}
            {steer && allows("retry") && (
              <Button onClick={act("retryAgentSession", "Retrying")}>
                <RotateCcw className="size-3.5" aria-hidden /> Retry
              </Button>
            )}
          </>
        }
      />
      {/* Who and where, on one line (it scrolls sideways on phones). */}
      <div
        data-session-meta
        className="flex h-9 shrink-0 [scrollbar-width:none] items-center gap-x-3 overflow-x-auto border-b px-4 text-xs whitespace-nowrap text-muted-foreground sm:px-6 [&>*]:shrink-0"
      >
        <SessionStateChip state={state} className="sm:hidden" />
        <AgentActor agent={agent} ownerId={agent?.ownerId} size={16} />
        {agent && <Meta>{harnessLabel(agent.harness)}</Meta>}
        {runner && (
          <Meta icon={<Server />} label="Runner">
            {runner.name}
          </Meta>
        )}
        {itemKey && (
          <Link
            href={paths.item(org, project!.key, itemKey)}
            className="rounded-sm font-mono focus-ring outline-none hover:text-foreground"
          >
            {itemKey}
          </Link>
        )}
        {session.branch && (
          <Meta icon={<GitBranch />} label="Branch">
            <span className="font-mono">{session.branch}</span>
          </Meta>
        )}
        {session.pullRequestId ? (
          <Link
            href={paths.codePullRequest(org, session.pullRequestId)}
            className="flex items-center gap-1 rounded-sm font-medium text-foreground focus-ring outline-none hover:underline"
          >
            <GitPullRequest className="size-3.5" aria-hidden /> Pull request
          </Link>
        ) : (
          session.pullRequestUrl && (
            <a
              href={session.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-sm font-medium text-foreground focus-ring outline-none hover:underline"
            >
              <GitPullRequest className="size-3.5" aria-hidden /> Pull request
            </a>
          )
        )}
        <span className="flex items-center gap-1">
          Started by <SessionStarter session={session} />
          <time
            dateTime={session.createdAt}
            title={absoluteTime(session.createdAt)}
          >
            {relativeTime(session.createdAt)}
          </time>
        </span>
        {session.attempts > 1 && (
          <span>
            Attempt {session.attempts} of {session.maxAttempts}
          </span>
        )}
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          {truncated && (
            <div className="mb-4 text-center">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setLimit((l) => Math.min(MAX_WINDOW, l + WINDOW))
                }
              >
                Show earlier events
              </Button>
            </div>
          )}
          <ol aria-label="Session transcript" className="space-y-2">
            {transcript.map((entry) => {
              const key =
                entry.kind === "tool"
                  ? `t${entry.call.sequence}`
                  : `e${entry.event.sequence}`;
              return (
                <li
                  key={key}
                  className="[contain-intrinsic-size:auto_2rem] [content-visibility:auto]"
                >
                  <TranscriptRow
                    item={entry}
                    session={session}
                    agent={agent}
                    memberName={memberName}
                  />
                </li>
              );
            })}
          </ol>
          {Boolean(session.resultSummary ?? session.error) &&
            ["completed", "failed"].includes(session.status) && (
              <Result summary={session.resultSummary} error={session.error} />
            )}
        </div>
      </div>
      {asks.length > 0 && (
        <section
          aria-label={steer ? "Waiting on you" : state.label}
          className="max-h-[55%] shrink-0 overflow-y-auto border-t bg-warning/5 px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-3xl space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]">
              <Hand className="size-3.5" aria-hidden />
              {steer ? "Waiting on you" : state.label}
            </p>
            {asks.map((approval) => (
              <ApprovalRequest
                key={approval.id}
                session={session}
                approval={approval}
                agent={agent}
                runner={runner}
                linkSession={false}
              />
            ))}
          </div>
        </section>
      )}
      {steer && allows("sendMessage") && (
        <div className="shrink-0 border-t bg-background pt-3">
          <Composer
            key={session.id}
            draftKey={`${organization.id}:session:${session.id}`}
            organizationId={organization.id}
            label="Message the agent"
            placeholder={
              session.status === "queued"
                ? "Add instructions before it starts…"
                : session.status === "waiting" && !asks.length
                  ? `${agent?.name ?? "The agent"} is waiting for your next message…`
                  : `Steer ${agent?.name ?? "the agent"}…`
            }
            mentions={[]}
            references={false}
            maxLength={8000}
            hint="Enter to send · Shift+Enter for a new line · the agent reads it on its next turn"
            onSend={(text) =>
              void callCapability("sendAgentSessionMessage", {
                organizationId: organization.id,
                sessionId: session.id,
                text,
              }).catch((error: unknown) =>
                toast({
                  type: "error",
                  title: "The message was not sent",
                  description: (error as Error).message,
                }),
              )
            }
            autoFocus
            className="mx-auto max-w-3xl px-4 sm:mx-auto sm:px-6"
          />
        </div>
      )}
    </div>
  );
}

function Meta({
  icon,
  label,
  children,
}: {
  icon?: ReactNode;
  // Names the icon for people who cannot see it.
  label?: string;
  children: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      {icon && (
        <span aria-hidden className="[&_svg]:size-3.5">
          {icon}
        </span>
      )}
      {label && <span className="sr-only">{label}:</span>}
      {children}
    </span>
  );
}

function Result({
  summary,
  error,
}: {
  summary: string | null;
  error: string | null;
}) {
  return (
    <div
      className={cn(
        "mt-4 rounded-xl px-4 py-3 text-[13px] shadow-(--shadow-border)",
        error ? "bg-destructive/6" : "bg-success/6",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <SquareTerminal className="size-3.5" aria-hidden />
        {error ? "The session failed" : "The agent reports it is done"}
      </p>
      {summary && <p className="mt-1 whitespace-pre-wrap">{summary}</p>}
      {error && (
        <p className="mt-1 whitespace-pre-wrap text-destructive">{error}</p>
      )}
      {!error && (
        <p className="mt-2 text-xs text-muted-foreground">
          A claim, not proof: the pull request, its checks and the Definition of
          Done decide.
        </p>
      )}
    </div>
  );
}
