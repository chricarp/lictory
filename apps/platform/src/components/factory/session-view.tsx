import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  CircleStop,
  GitBranch,
  GitPullRequest,
  Hand,
  RotateCcw,
  Send,
  Server,
} from "lucide-react";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import { agentSession } from "@lictory/core/contracts/state-machines";
import { cn } from "@lictory/core/lib/utils";
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { inputClass } from "@lictory/ui/input";
import { EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { toast } from "@lictory/ui/toast";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { harnessLabel } from "@lictory/platform/components/factory/labels";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  AgentMark,
  AgentName,
  SessionStatusBadge,
  canAnswerSession,
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

// Events are synchronized in windows; "Show earlier" widens the window.
const WINDOW = 200;
const MAX_WINDOW = 2000;

export function SessionView() {
  const { session: sessionId = "" } = useParams<{ session: string }>();
  const { organization, userId, isAdmin, memberName, items, projects } =
    useWorkspace();
  const { agentById, runnerById } = useFactory();
  const { session, complete } = useSession(sessionId);
  const [limit, setLimit] = useState(WINDOW);
  const { events } = useSessionEvents(sessionId, limit);
  const org = organization.slug;
  const transcript = useMemo(() => transcriptItems(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new events while the reader is at the bottom.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [transcript.length]);

  if (!session)
    return complete ? (
      <EmptyState title="This session does not exist">
        It may belong to another organization.{" "}
        <Link href={factoryPaths.overview(org)} className="underline">
          Back to the Factory
        </Link>
      </EmptyState>
    ) : (
      <LoadingState label="Loading the session" />
    );

  const agent = agentById.get(session.agentId);
  const runner = session.runnerId
    ? runnerById.get(session.runnerId)
    : undefined;
  const steer = session.requestedById === userId || agent?.ownerId === userId;
  const canAnswer = canAnswerSession(session, agent, userId);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-wrap items-start gap-x-3 gap-y-2">
          <Link
            href={factoryPaths.overview(org)}
            aria-label="Back to the Factory"
            className="mt-0.5 grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div className="min-w-0 flex-1 basis-72">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold">
                {session.title}
              </h1>
              <SessionStatusBadge session={session} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentMark agent={agent} className="size-4 text-[10px]" />
                <AgentName agent={agent} />
                {agent && <span>· {harnessLabel(agent.harness)}</span>}
              </span>
              <span>Started by {memberName(session.requestedById)}</span>
              {runner && (
                <span className="flex items-center gap-1">
                  <Server className="size-3" aria-hidden /> {runner.name}
                </span>
              )}
              {item && project && (
                <Link
                  href={paths.item(org, project.key, item.id)}
                  className="font-mono hover:text-foreground"
                >
                  {project.key}-{item.number}
                </Link>
              )}
              {session.branch && (
                <span className="flex min-w-0 items-center gap-1 font-mono">
                  <GitBranch className="size-3" aria-hidden />
                  <span className="truncate">{session.branch}</span>
                </span>
              )}
              {session.pullRequestId && (
                <Link
                  href={paths.codePullRequest(org, session.pullRequestId)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  <GitPullRequest className="size-3" aria-hidden /> Pull request
                </Link>
              )}
              <time
                dateTime={session.createdAt}
                title={absoluteTime(session.createdAt)}
              >
                {relativeTime(session.createdAt)}
              </time>
              {session.attempts > 1 && (
                <span>
                  Attempt {session.attempts} of {session.maxAttempts}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {steer && allows("interrupt") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={act("interruptAgentSession", "Interrupting")}
              >
                <Hand className="size-3.5" aria-hidden /> Interrupt
              </Button>
            )}
            {(steer || isAdmin) && allows("cancel") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={act("cancelAgentSession", "Canceling")}
              >
                <CircleStop className="size-3.5" aria-hidden /> Cancel
              </Button>
            )}
            {steer && allows("retry") && (
              <Button size="sm" onClick={act("retryAgentSession", "Retrying")}>
                <RotateCcw className="size-3.5" aria-hidden /> Retry
              </Button>
            )}
          </div>
        </div>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="mx-auto max-w-4xl space-y-3 px-4 py-5 sm:px-6">
          {truncated && (
            <div className="text-center">
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
          <ol aria-label="Session transcript" className="space-y-3">
            {transcript.map((entry) => {
              const key =
                entry.kind === "tool"
                  ? `t${entry.call.sequence}`
                  : `e${entry.event.sequence}`;
              return (
                <li
                  key={key}
                  className="[contain-intrinsic-size:auto_2.5rem] [content-visibility:auto]"
                >
                  <TranscriptRow
                    item={entry}
                    session={session}
                    agent={agent}
                    memberName={memberName}
                    canAnswer={canAnswer}
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
      {steer && allows("sendMessage") && (
        <Composer
          sessionId={session.id}
          waiting={session.status === "queued"}
        />
      )}
    </div>
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
        "rounded-xl px-4 py-3 text-[13px] shadow-(--shadow-border)",
        error ? "bg-destructive/6" : "bg-success/6",
      )}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {error ? "The session failed" : "The agent reports it is done"}
      </div>
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

function Composer({
  sessionId,
  waiting,
}: {
  sessionId: string;
  waiting: boolean;
}) {
  const { organization } = useWorkspace();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  const send = async () => {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    try {
      await callCapability("sendAgentSessionMessage", {
        organizationId: organization.id,
        sessionId,
        text: message,
      });
      setText("");
    } catch (error) {
      toast({
        type: "error",
        title: "The message was not sent",
        description: (error as Error).message,
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <form
      className="shrink-0 border-t bg-background px-4 py-3 sm:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="mx-auto flex max-w-4xl items-end gap-2">
        <label htmlFor={id} className="sr-only">
          Message the agent
        </label>
        <Textarea
          ref={field}
          id={id}
          rows={1}
          value={text}
          maxLength={8000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={
            waiting ? "Add instructions before it starts…" : "Steer the agent…"
          }
          className={cn(
            inputClass,
            "h-auto max-h-40 min-h-10 resize-none py-2 text-[14px] leading-6",
          )}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={!text.trim() || pending}
          className="mb-1.5 size-8"
        >
          <Send className="size-3.5" aria-hidden />
        </Button>
      </div>
    </form>
  );
}
