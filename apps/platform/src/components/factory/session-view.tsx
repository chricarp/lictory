import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MissingState } from "@lictory/ui/status-page";
import {
  CircleStop,
  GitBranch,
  GitPullRequest,
  Hand,
  MoreHorizontal,
  RotateCcw,
  Server,
  SquareTerminal,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { agentSession } from "@lictory/core/contracts/state-machines";
import { sessionTitle } from "@lictory/core/factory/entities";
import { useAnnounceSession } from "@lictory/platform/components/factory/announce";
import { cn } from "@lictory/core/lib/utils";
import {
  absoluteTime,
  identifier,
  relativeTime,
} from "@lictory/core/lib/work-items";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@lictory/ui/menu";
import { LoadingState } from "@lictory/ui/spinner";
import { toast } from "@lictory/ui/toast";
import { Tooltip } from "@lictory/ui/tooltip";
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
  MiddleTruncate,
  SessionStarter,
  useSessionDuration,
  useSessionStateOf,
} from "@lictory/platform/components/factory/parts";
import { formatDuration } from "@lictory/platform/components/factory/overview-blocks";
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
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { events } = useSessionEvents(sessionId, limit);
  const org = organization.slug;
  const transcript = useMemo(() => transcriptItems(events), [events]);
  // Errors the log already shows, so the outcome does not repeat them.
  const shownErrors = useMemo(
    () =>
      new Set(
        events.flatMap((e) => {
          const message = (e.data as { message?: unknown } | null)?.message;
          return e.type === "error" && typeof message === "string"
            ? [message.trim()]
            : [];
        }),
      ),
    [events],
  );
  // Summaries the log already shows, so the outcome does not repeat them.
  const shownSummaries = useMemo(
    () =>
      new Set(
        events.flatMap((e) => {
          const text = (e.data as { text?: unknown } | null)?.text;
          return e.type === "summary" && typeof text === "string"
            ? [text.trim()]
            : [];
        }),
      ),
    [events],
  );
  // Its requests and its outcome are announced while the page is open.
  useAnnounceSession(
    session,
    (session && agentById.get(session.agentId)?.name) ?? "The agent",
    session ? sessionTitle(session.title) : "",
    session?.error,
  );
  const ran = useSessionDuration(session);
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
          // The same not-found as items and channels: what is missing, why
          // it may be, and the way back.
          <MissingState
            illustration="search"
            headingLevel={2}
            title="This session does not exist"
            action={
              <Button variant="secondary" render={<Link href={back.href} />}>
                Back to the Factory
              </Button>
            }
          >
            It may belong to another organization, or the link may be wrong.
          </MissingState>
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
  const canInterrupt = steer && allows("interrupt");
  const canCancel = (steer || isAdmin) && allows("cancel");
  const interrupt = act("interruptAgentSession", "Interrupting");
  const cancelNow = act("cancelAgentSession", "Canceling");
  // Cancel ends the run (Interrupt only pauses it): asked once, so the
  // destructive one is never picked in a hurry.
  const cancel = () => setConfirmingCancel(true);
  const asks = session.status === "waiting" ? session.approvals : [];
  const itemKey = item && project ? identifier(project, item.number) : null;
  // Where it was asked for: its channel thread, if a mention started it.
  const thread =
    session.channelId && session.threadRootMessageId
      ? `${paths.channel(org, session.channelId)}?thread=${session.threadRootMessageId}`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={back}
        title={sessionTitle(session.title)}
        actions={
          <>
            <SessionStateChip state={state} className="max-sm:hidden" />
            {/* Laptops: labelled buttons. Phones: one labelled menu, so
                the title keeps the bar. */}
            {canInterrupt && (
              <Tooltip label={INTERRUPT_HINT} side="left">
                <Button
                  variant="secondary"
                  className="max-md:hidden"
                  onClick={interrupt}
                >
                  <Hand className="size-3.5" aria-hidden /> Interrupt
                </Button>
              </Tooltip>
            )}
            {canCancel && (
              <Tooltip label={CANCEL_HINT} side="left">
                <Button
                  variant="secondary"
                  className="max-md:hidden"
                  onClick={cancel}
                >
                  <CircleStop className="size-3.5" aria-hidden /> Cancel…
                </Button>
              </Tooltip>
            )}
            {(canInterrupt || canCancel) && (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Session actions"
                      className="size-8 md:hidden"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </MenuTrigger>
                <MenuContent align="end" width={200}>
                  {canInterrupt && (
                    <MenuItem onSelect={() => void interrupt()}>
                      <Hand className="size-3.5 text-muted-foreground" />{" "}
                      <span>
                        Interrupt
                        <span className="block text-xs text-muted-foreground">
                          It stops and waits for you
                        </span>
                      </span>
                    </MenuItem>
                  )}
                  {canCancel && (
                    <MenuItem onSelect={() => void cancel()}>
                      <CircleStop className="size-3.5 text-muted-foreground" />{" "}
                      <span>
                        Cancel session…
                        <span className="block text-xs text-muted-foreground">
                          It ends; Retry starts it over
                        </span>
                      </span>
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            )}
            {steer && allows("retry") && (
              <Tooltip label={RETRY_HINT} side="left">
                <Button onClick={act("retryAgentSession", "Retrying")}>
                  <RotateCcw className="size-3.5" aria-hidden /> Retry
                </Button>
              </Tooltip>
            )}
          </>
        }
      />
      {confirmingCancel && canCancel && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-destructive/5 px-4 py-2.5 text-[13px] sm:px-6"
        >
          <span className="mr-auto">
            Cancel this session? It ends now; Retry starts it over from the
            task. To pause it instead, choose Interrupt.
          </span>
          <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
            Keep it running
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingCancel(false);
              void cancelNow();
            }}
          >
            Cancel session
          </Button>
        </div>
      )}
      {/* Who and where, on one line. The branch gives way first, cut in
          the middle, so who started the session and when stay in view. On
          phones the facts wrap instead: who acts and who is accountable
          must never be the part scrolled out of sight. */}
      <div
        data-session-meta
        className="flex shrink-0 items-center gap-x-3 border-b px-4 text-xs whitespace-nowrap text-muted-foreground max-sm:flex-wrap max-sm:gap-y-1.5 max-sm:py-2 sm:h-9 sm:scroll-fade-x sm:[scrollbar-width:none] sm:overflow-x-auto sm:px-6 [&>*:not([data-shrink])]:shrink-0"
      >
        <SessionStateChip state={state} className="sm:hidden" />
        {/* Who and what first: the agent, who started it, the item and
            its pull request. Then, quieter, where it runs. */}
        <AgentActor agent={agent} ownerId={agent?.ownerId} size={20} />
        <span className="flex items-center gap-1">
          started by <SessionStarter session={session} />
          <time
            dateTime={session.createdAt}
            title={absoluteTime(session.createdAt)}
          >
            {relativeTime(session.createdAt)}
          </time>
        </span>
        {ran !== null && (
          <span className="tabular-nums">
            {!state.active
              ? "ran "
              : session.status === "waiting"
                ? "open for "
                : "running for "}
            {formatDuration(ran)}
          </span>
        )}
        {itemKey && (
          <Link
            href={paths.item(org, project!.key, itemKey)}
            className="rounded-sm font-mono text-foreground focus-ring outline-none hover:underline"
          >
            {itemKey}
          </Link>
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
        <span aria-hidden className="h-3.5 w-px bg-border" />
        {runner && (
          <Meta icon={<Server />} label="Runner">
            {runner.name}
          </Meta>
        )}
        {agent && <Meta>{harnessLabel(agent.harness)}</Meta>}
        {/* A branch exists only in a repository: a session that started
            in an empty workspace has none to show. */}
        {session.branch &&
          (session.repositoryId ??
            session.repositoryUrl ??
            !session.startedAt) && (
            <Meta icon={<GitBranch />} label="Branch" shrink>
              <MiddleTruncate text={session.branch} className="font-mono" />
            </Meta>
          )}
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
          <ol aria-label="Session transcript" className="space-y-1">
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
          {/* The outcome, unless the log already ends with the same error. */}
          {Boolean(session.resultSummary ?? session.error) &&
            ["completed", "failed"].includes(session.status) &&
            !(session.error && shownErrors.has(session.error.trim())) && (
              <Result
                // The summary the log already shows is not repeated.
                summary={
                  session.resultSummary &&
                  shownSummaries.has(session.resultSummary.trim())
                    ? null
                    : session.resultSummary
                }
                error={session.error}
              />
            )}
          {/* A failure is the start of a decision: retry as is, or go
              back to the work or the conversation and change the ask. */}
          {session.status === "failed" && steer && (itemKey ?? thread) && (
            <p className="mt-3 text-xs text-muted-foreground">
              Retry runs the same task again. To change what it is asked,
              {itemKey ? (
                <>
                  {" "}
                  update{" "}
                  <Link
                    href={paths.item(org, project!.key, itemKey)}
                    className="font-mono text-foreground underline-offset-2 focus-ring outline-none hover:underline"
                  >
                    {itemKey}
                  </Link>
                </>
              ) : null}
              {itemKey && thread ? " or" : ""}
              {thread ? (
                <>
                  {" "}
                  reply in{" "}
                  <Link
                    href={thread}
                    className="text-foreground underline-offset-2 focus-ring outline-none hover:underline"
                  >
                    its thread
                  </Link>
                </>
              ) : null}{" "}
              and start a new session.
            </p>
          )}
        </div>
      </div>
      {/* Waiting for a message: the composer says so to the person who
          can answer (one call to action, not a banner repeating it); the
          others, who have no composer, get the line instead. */}
      {session.status === "waiting" && !asks.length && !steer && (
        <p
          data-waiting-for-message
          className="flex shrink-0 items-center justify-center gap-1.5 border-t bg-warning/5 px-4 py-2 text-xs font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))] sm:px-6 dark:bg-transparent"
        >
          <Hand className="size-3.5 shrink-0" aria-hidden />
          {`${state.label}: ${agent?.name ?? "the agent"} waits for the next message.`}
        </p>
      )}
      {asks.length > 0 && (
        <section
          aria-label={steer ? "Waiting on you" : state.label}
          // Urgency is a rule in the warning color along its top; a tint
          // over the whole band read as dirty olive on near-black.
          className="max-h-[55%] shrink-0 overflow-y-auto border-t-2 border-warning/60 bg-warning/5 px-4 py-3 sm:px-6 dark:bg-transparent"
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

const INTERRUPT_HINT =
  "Stops the agent’s current turn. It keeps its work and waits for your next message.";
const CANCEL_HINT =
  "Ends the session. Retry starts it over from the task, with the messages you sent.";
const RETRY_HINT =
  "Runs the session again from the task; your earlier messages are sent again.";

function Meta({
  icon,
  label,
  shrink = false,
  children,
}: {
  icon?: ReactNode;
  // Names the icon for people who cannot see it.
  label?: string;
  // Gives way when the line is full (down to about eight characters).
  shrink?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-shrink={shrink || undefined}
      className={cn("flex min-w-0 items-center gap-1", shrink && "min-w-24")}
    >
      {icon && (
        <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
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
