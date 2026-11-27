import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CircleStop,
  CircleHelp,
  FileDiff,
  GitPullRequest,
  Hand,
  MessageSquareText,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { agentSession } from "@lictory/core/contracts/state-machines";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { sessionTitle, waitsForRunner } from "@lictory/core/factory/entities";
import type {
  ApprovalCardPayload,
  QuestionCardPayload,
  SessionCardPayload,
} from "@lictory/core/factory/session-cards";
import { Button } from "@lictory/ui/button";
import { toast } from "@lictory/ui/toast";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { ReferenceChip } from "@lictory/platform/components/references/chips";
import {
  useFactory,
  useSession,
  useSessionEvents,
} from "@lictory/platform/components/factory/store";
import {
  filesChangedLabel,
  sessionProgress,
} from "@lictory/platform/components/factory/progress";
import { firstName, sessionState } from "@lictory/platform/lib/session-state";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import {
  ApprovalRequest,
  Decide,
} from "@lictory/platform/components/shell/approval-request";
import { titledByItem } from "@lictory/platform/components/channels/data";
import { useAnnounceSession } from "@lictory/platform/components/factory/announce";
import { useCodePullRequest } from "@lictory/platform/components/code/store";
import {
  PullRequestIcon,
  stateWords,
} from "@lictory/platform/components/code/parts";

// What the Factory writes into a channel thread
// (docs/internals/factory.md#sessions-in-channels): a session's live card,
// each approval request where it was asked (answered there, then its
// record), and an agent's question pointing at the anchored discussion. The card's
// payload is the server's snapshot; the session card reads the session's
// own synchronized projection when it is in the browser's window, so it is
// live without polling.

export type FactoryCardPayload =
  SessionCardPayload | ApprovalCardPayload | QuestionCardPayload;

export function factoryCardOf(
  payload: Readonly<Record<string, unknown>> | null | undefined,
): FactoryCardPayload | undefined {
  const type = payload?.type;
  return type === "agentSession" ||
    type === "agentApproval" ||
    type === "agentQuestion"
    ? (payload as FactoryCardPayload)
    : undefined;
}

const cardClass =
  "mt-1 max-w-2xl rounded-xl bg-card text-[13px] shadow-(--shadow-border) [--actor-ring:var(--card)]";

export function FactoryCard({
  payload,
  detailed = false,
  root = false,
}: {
  payload: FactoryCardPayload;
  // Shown in a thread panel: what the agent did, even once it finished.
  detailed?: boolean;
  // The card starts its thread (a dispatched session's report), so its
  // title is the only place the work is named.
  root?: boolean;
}) {
  if (payload.type === "agentSession")
    return <SessionCard card={payload} detailed={detailed} root={root} />;
  if (payload.type === "agentApproval") return <ApprovalCard card={payload} />;
  return <QuestionCard card={payload} />;
}

const LAST_EVENTS = 200;

// A session's live card: its state, the item, the last thing the agent did
// and the files it changed, the pull request once there is one, and what
// it asks (answered right here). The prompt is the message above it, so it
// is not repeated.
function SessionCard({
  card,
  detailed,
  root,
}: {
  card: SessionCardPayload;
  detailed: boolean;
  root: boolean;
}) {
  const { organization, userId, memberName } = useWorkspace();
  const { session } = useSession(card.sessionId);
  const { agentById, runnerById, runners } = useFactory();
  const agent = agentById.get(card.agentId);
  const status = session?.status ?? card.status;
  const summary = session?.resultSummary ?? card.summary;
  const error = session?.error ?? card.error;
  const title = sessionTitle(session?.title ?? card.title);
  // Its requests and results are announced where the card is read.
  useAnnounceSession(session, card.agentName, title, error);
  const decider =
    (session?.requestedById ?? card.requestedById) === userId ||
    card.ownerId === userId
      ? "you"
      : memberName(session?.requestedById ?? card.requestedById);
  const discardedFiles = session?.discardedFiles ?? card.discardedFiles ?? 0;
  const state = sessionState(session ?? { status, discardedFiles }, {
    decider,
    noRunner: session ? waitsForRunner(session, agent, runners) : false,
  });
  // The session's own projection knows its pull request first; the card's
  // payload links Lictory's page.
  const pullRequest =
    card.pullRequest ??
    (session?.pullRequestId
      ? {
          id: session.pullRequestId,
          path: paths.codePullRequest(organization.slug, session.pullRequestId),
          url: session.pullRequestUrl,
        }
      : null);
  // What it asks is answered on the card, in the channel and in its
  // thread alike: one object holds the session's state and the decision it
  // waits for. Where it was asked, the thread keeps a one-line entry, so
  // the thread still reads in order.
  const asks = session && status === "waiting" ? session.approvals : [];
  // A dispatched session is titled after its item ("PAY-10: Refund
  // button…"); the item's chip already names it, so the title is not
  // repeated under it.
  const namedByChip = titledByItem(card, title);
  return (
    // An article, not a region: a channel holds many cards, and each is
    // named by its agent and task so a list of them tells them apart.
    <article
      aria-label={`${card.agentName} session: ${title}`}
      data-session-card={card.sessionId}
      className={cardClass}
    >
      {/* Wraps in a narrow thread panel rather than running past it. */}
      <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <SessionStateChip state={state} />
        {card.workItemId && card.workItemKey && (
          <ReferenceChip
            target={{ kind: "item", id: card.workItemId }}
            label={card.workItemKey}
          />
        )}
        {pullRequest && (
          <CardPullRequest id={pullRequest.id} path={pullRequest.path} />
        )}
        <Link
          href={card.path}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
        >
          {/* Labelled on phones too: a bare arrow is a hard target to
              find for the card's main way on. */}
          <span>Open session</span>
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
        {detailed && session && (
          <SessionControls
            session={session}
            steer={decider === "you"}
            agentName={card.agentName}
          />
        )}
      </div>
      {root && !namedByChip && <p className="px-3 pb-2 font-medium">{title}</p>}
      <Progress
        sessionId={card.sessionId}
        live={state.active || detailed}
        // The request itself is shown; its title is not repeated as a step.
        asking={asks.length > 0}
        // Ended with no repository: what it changed was not kept anywhere.
        discarded={
          !!session &&
          !state.active &&
          !session.repositoryId &&
          !session.repositoryUrl
        }
      />
      {status === "waiting" && session && !asks.length && (
        <p className="flex items-center gap-1.5 border-t px-3 py-2 text-xs font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]">
          <Hand className="size-3.5 shrink-0" aria-hidden />
          {decider === "you"
            ? `${card.agentName} waits for your next message: reply in this thread.`
            : `${card.agentName} waits for ${firstName(decider)}’s next message.`}
        </p>
      )}
      {/* Where the files themselves are not listed, the card still says
          the work was not kept, and the agent's summary reads as its
          report, not as what happened. */}
      {status === "completed" &&
        discardedFiles > 0 &&
        !(state.active || detailed) && (
          <p className="flex items-start gap-1.5 border-t px-3 py-2 text-xs font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            Not kept:{" "}
            {discardedFiles === 1 ? "1 file" : `${discardedFiles} files`}{" "}
            discarded when the session ended, because no repository is linked
            to it.
          </p>
        )}
      {status === "completed" && summary && (
        <p className="line-clamp-3 border-t px-3 py-2 text-muted-foreground">
          {discardedFiles > 0 && (
            <span className="font-medium text-foreground">
              {card.agentName} reported:{" "}
            </span>
          )}
          {summary}
        </p>
      )}
      {status === "failed" && error && (
        <p className="line-clamp-3 border-t px-3 py-2 text-destructive">
          {error}
        </p>
      )}
      {session &&
        asks.map((approval) => (
          <div key={approval.id} className="border-t">
            <ApprovalRequest
              embedded
              session={session}
              approval={approval}
              agent={agent}
              runner={
                session.runnerId ? runnerById.get(session.runnerId) : undefined
              }
              linkSession={false}
              // The card's header chip already names the item.
              linkItem={!(card.workItemId && card.workItemKey)}
            />
          </div>
        ))}
    </article>
  );
}

// The session's pull request by number and state ("#7, merged"), from the
// Code module's mirror; "Pull request" until the mirror has it.
function CardPullRequest({ id, path }: { id: string; path: string }) {
  const { pullRequest } = useCodePullRequest(id);
  return (
    <Link
      href={path}
      className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium focus-ring outline-none hover:underline"
    >
      {pullRequest ? (
        <>
          <span aria-hidden className="contents">
            <PullRequestIcon
              state={pullRequest.state}
              draft={pullRequest.draft}
              className="size-3.5"
            />
          </span>
          <span>
            <span className="sr-only">Pull request </span>#{pullRequest.number}
            <span className="font-normal text-muted-foreground">
              {" "}
              {stateWords[pullRequest.state].toLowerCase()}
            </span>
          </span>
        </>
      ) : (
        <>
          <GitPullRequest className="size-3.5" aria-hidden /> Pull request
        </>
      )}
    </Link>
  );
}

// Stop controls where people steer: Interrupt (the agent stops its turn and
// waits) and Cancel (the session ends; Retry starts it over), by the same
// rules as the session page. Cancel asks once, since it ends the run.
function SessionControls({
  session,
  steer,
  agentName,
}: {
  session: NonNullable<ReturnType<typeof useSession>["session"]>;
  steer: boolean;
  agentName: string;
}) {
  const { organization, isAdmin } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const canInterrupt =
    steer && agentSession.allows(session.status, "interrupt");
  const canCancel =
    (steer || isAdmin) && agentSession.allows(session.status, "cancel");
  if (!canInterrupt && !canCancel) return null;
  const act = (name: string, label: string) => async () => {
    try {
      await callCapability(name, {
        organizationId: organization.id,
        sessionId: session.id,
      });
      setConfirming(false);
    } catch (error) {
      toast({
        type: "error",
        title: `${label} failed`,
        description: (error as Error).message,
      });
    }
  };
  // In the card's header row: the buttons beside "Open session", and the
  // confirmation on a line of its own.
  if (confirming)
    return (
      <div className="flex basis-full flex-wrap items-center gap-2 border-t pt-1.5 text-xs">
        <span className="mr-auto">
          Cancel {agentName}’s session? It ends; Retry starts it over.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Keep it running
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={act("cancelAgentSession", "Canceling")}
        >
          Cancel session
        </Button>
      </div>
    );
  return (
    <span className="flex shrink-0 items-center gap-1">
      {canInterrupt && (
        <Button
          size="sm"
          variant="secondary"
          title="Stops its turn; it waits for your next message."
          onClick={act("interruptAgentSession", "Interrupting")}
        >
          <Hand className="size-3.5" aria-hidden /> Interrupt
        </Button>
      )}
      {canCancel && (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          <CircleStop className="size-3.5" aria-hidden /> Cancel…
        </Button>
      )}
    </span>
  );
}

// What the agent did last and the files it changed, read from the event
// log while the session moves (or when the card is read in its thread).
function Progress({
  sessionId,
  live,
  asking,
  discarded,
}: {
  sessionId: string;
  live: boolean;
  asking: boolean;
  discarded: boolean;
}) {
  if (!live) return null;
  return (
    <LiveProgress sessionId={sessionId} asking={asking} discarded={discarded} />
  );
}

function LiveProgress({
  sessionId,
  asking,
  discarded,
}: {
  sessionId: string;
  asking: boolean;
  discarded: boolean;
}) {
  const { events } = useSessionEvents(sessionId, LAST_EVENTS);
  const progress = useMemo(() => sessionProgress(events), [events]);
  // While the agent asks, the request below carries the files with its
  // evidence; they are not listed twice.
  const files = asking ? [] : progress.files;
  // The request is shown, and a last step that only changed files is the
  // files line below: neither is said twice.
  const step =
    (asking && progress.step?.kind === "approval") ||
    (files.length > 0 && progress.step?.kind === "files")
      ? null
      : progress.step;
  if (!step && !files.length) return null;
  return (
    <div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
      {step && (
        <p className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="shrink-0 [&_svg]:size-3.5">
            {stepIcons[step.kind]}
          </span>
          <span className="sr-only">Last step: </span>
          {step.kind === "command" ? (
            <>
              <span className="shrink-0">Ran</span>
              <code className="min-w-0 truncate font-mono text-foreground">
                {step.text}
              </code>
              {step.exitCode !== null && step.exitCode !== 0 && (
                <span className="shrink-0 text-destructive tabular-nums">
                  exit {step.exitCode}
                </span>
              )}
            </>
          ) : (
            <span className="min-w-0 truncate text-foreground">
              {step.text}
            </span>
          )}
        </p>
      )}
      {files.length > 0 && discarded && (
        // Said in full, not truncated: the agent's summary reads as if the
        // change exists, and it does not.
        <p className="flex items-start gap-1.5 font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Not kept: {filesChangedLabel(progress).replace(/ changed$/, "")} (
            <span className="font-mono font-normal break-all">
              {files.map((f) => f.path).join(", ")}
            </span>
            ) discarded when the session ended, because no repository is linked
            to it.
          </span>
        </p>
      )}
      {files.length > 0 && !discarded && (
        <p className="flex min-w-0 items-center gap-1.5">
          <FileDiff aria-hidden className="size-3.5 shrink-0" />
          <span className="shrink-0">{filesChangedLabel(progress)}</span>
          {(progress.additions > 0 || progress.deletions > 0) && (
            <span className="shrink-0 tabular-nums">
              +{progress.additions} −{progress.deletions}
            </span>
          )}
          <span className="min-w-0 truncate font-mono">
            {files
              .slice(0, 3)
              .map((f) => f.path.split("/").pop())
              .join(", ")}
          </span>
        </p>
      )}
    </div>
  );
}

const stepIcons = {
  command: <SquareTerminal />,
  tool: <Wrench />,
  message: <MessageSquareText />,
  files: <FileDiff />,
  approval: <ShieldQuestion />,
} as const;

// An agent's request in its thread, where it was asked, so the thread reads
// in order: one line saying what it asked. While it is pending and the
// browser can read the session, the session's card holds the request (what
// is asked, the evidence, Approve and Deny), so the line says where to
// answer instead of repeating it; without the session (no access to the
// Factory) the line carries its own Approve and Deny. Once answered it is
// the record of who decided.
function ApprovalCard({ card: approval }: { card: ApprovalCardPayload }) {
  const { userId, memberName } = useWorkspace();
  const { session } = useSession(approval.sessionId);
  const pending = approval.status === "pending";
  const mayDecide = approval.deciderIds.includes(userId);
  // A request that names no tool is a question: answered in words, never
  // approved.
  const question = !approval.tool;
  const onCard = Boolean(
    pending &&
    session?.status === "waiting" &&
    session.approvals.some((a) => a.id === approval.approvalId),
  );
  const deciders = approval.deciderIds.map((id) => firstName(memberName(id)));
  return (
    <article
      aria-label={
        question
          ? `${approval.agentName} asks: ${approval.title}`
          : `${approval.agentName} asks for approval`
      }
      data-approval-record={approval.approvalId}
      className="mt-0.5 flex max-w-2xl items-start gap-2 text-[13px]"
    >
      <ShieldQuestion
        className={cn(
          "mt-0.5 size-4 shrink-0",
          pending ? "text-warning" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p>
          <span className="text-muted-foreground">
            {question ? "Asks " : "Asks to approve "}
          </span>
          <span className="font-medium">{approval.title}</span>
          {approval.tool && (
            <span className="text-muted-foreground">
              {" "}
              (<code className="font-mono text-xs">{approval.tool}</code>)
            </span>
          )}
        </p>
        {onCard ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mayDecide
              ? `Waiting on you: answer it on ${approval.agentName}’s session card above.`
              : `${deciders.join(" or ")} decides, on ${approval.agentName}’s session card above.`}
          </p>
        ) : pending ? (
          mayDecide ? (
            <div className="mt-1">
              <Decide
                sessionId={approval.sessionId}
                approvalId={approval.approvalId}
                question={question}
                agentName={approval.agentName}
                subject={approval.title}
              />
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {deciders.join(" or ")} decides.
            </p>
          )
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {approval.status === "approved"
              ? `Approved by ${memberName(approval.decidedById)}`
              : approval.status === "denied"
                ? `Denied by ${memberName(approval.decidedById)}`
                : approval.status === "answered"
                  ? `Answered by ${memberName(approval.decidedById)}`
                  : "Expired: the session ended before anyone answered."}
            {approval.note ? `: “${approval.note}”` : ""}
          </p>
        )}
      </div>
    </article>
  );
}

function QuestionCard({ card: question }: { card: QuestionCardPayload }) {
  const { memberName } = useWorkspace();
  const resolved = question.status === "resolved";
  return (
    <article
      aria-label={`${question.agentName} asks a question`}
      className={cn(cardClass, "px-3 py-2.5")}
    >
      <div className="flex items-start gap-2">
        <CircleHelp
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">
            {resolved ? "Question resolved" : "Question"} ·{" "}
            <ReferenceChip
              target={{ kind: "item", id: question.questionItemId }}
              label={question.questionItemKey}
            />
          </p>
          <p className="mt-0.5">{question.question}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolved
              ? `Resolved by ${memberName(question.resolvedById)}; ${question.agentName} continues.`
              : `${question.itemKey} waits for the answer.`}
          </p>
          {!resolved && (
            <Button
              variant="secondary"
              className="mt-2"
              render={<Link href={question.path} />}
            >
              Answer in the discussion
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
