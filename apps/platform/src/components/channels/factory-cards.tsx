import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  FileDiff,
  GitPullRequest,
  MessageSquareText,
  ShieldQuestion,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { sessionTitle } from "@lictory/core/factory/entities";
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
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import { titledByItem } from "@lictory/platform/components/channels/data";
import { useAnnounceSession } from "@lictory/platform/components/factory/announce";

// What the Factory writes into a channel thread
// (docs/internals/factory.md#sessions-in-channels): a session's live card
// (which holds what the agent asks, answered there), a record of each
// approval request, and an agent's question pointing at the anchored
// discussion. The card's
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
  const { agentById, runnerById } = useFactory();
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
  const state = sessionState(session ?? { status }, { decider });
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
      <div className="flex min-h-10 min-w-0 items-center gap-2 px-3 py-1.5">
        <SessionStateChip state={state} />
        {card.workItemId && card.workItemKey && (
          <ReferenceChip
            target={{ kind: "item", id: card.workItemId }}
            label={card.workItemKey}
          />
        )}
        {pullRequest && (
          <Link
            href={pullRequest.path}
            className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium focus-ring outline-none hover:underline"
          >
            <GitPullRequest className="size-3.5" aria-hidden /> Pull request
          </Link>
        )}
        <Link
          href={card.path}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
        >
          <span className="max-sm:sr-only">Open session</span>
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {root && !namedByChip && <p className="px-3 pb-2 font-medium">{title}</p>}
      <Progress
        sessionId={card.sessionId}
        live={state.active || detailed}
        // The request itself is below; its title is not repeated as a step.
        asking={asks.length > 0}
      />
      {status === "completed" && summary && (
        <p className="line-clamp-3 border-t px-3 py-2 text-muted-foreground">
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
          <div key={approval.id} className="border-t p-2">
            <ApprovalRequest
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

// What the agent did last and the files it changed, read from the event
// log while the session moves (or when the card is read in its thread).
function Progress({
  sessionId,
  live,
  asking,
}: {
  sessionId: string;
  live: boolean;
  asking: boolean;
}) {
  if (!live) return null;
  return <LiveProgress sessionId={sessionId} asking={asking} />;
}

function LiveProgress({
  sessionId,
  asking,
}: {
  sessionId: string;
  asking: boolean;
}) {
  const { events } = useSessionEvents(sessionId, LAST_EVENTS);
  const progress = useMemo(() => sessionProgress(events), [events]);
  const step =
    asking && progress.step?.kind === "approval" ? null : progress.step;
  // While the agent asks, the request below carries the files with its
  // evidence; they are not listed twice.
  const files = asking ? [] : progress.files;
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
      {files.length > 0 && (
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

// Whether the session's card shows this request right now (pending, and the
// session waits on it): then the card is where it is answered.
function shownOnCard(
  approval: ApprovalCardPayload,
  session: ReturnType<typeof useSession>["session"],
) {
  return (
    approval.status === "pending" &&
    session?.status === "waiting" &&
    session.approvals.some((a) => a.id === approval.approvalId)
  );
}

// In a thread that also holds the session's card, a pending request the
// card shows is one block, not two: its record line steps aside until it is
// answered ("Approved by Ada" then stays as history).
export function ApprovalRecordGate({
  payload,
  children,
}: {
  payload: ApprovalCardPayload;
  children: ReactNode;
}) {
  const { session } = useSession(payload.sessionId);
  return shownOnCard(payload, session) ? null : children;
}

// An agent's request in its thread. While the session card can show it, the
// request is answered there (one card per session); this line records it
// and leads to the card. Without the session (no access to the Factory),
// it carries its own Approve and Deny.
function ApprovalCard({ card: approval }: { card: ApprovalCardPayload }) {
  const { organization, userId, memberName } = useWorkspace();
  const { session } = useSession(approval.sessionId);
  const [sent, setSent] = useState<"approve" | "deny" | null>(null);
  const pending = approval.status === "pending";
  const mayDecide = approval.deciderIds.includes(userId);
  const onCard = shownOnCard(approval, session);
  const answer = async (decision: "approve" | "deny") => {
    setSent(decision);
    try {
      await callCapability("answerAgentApproval", {
        organizationId: organization.id,
        sessionId: approval.sessionId,
        approvalId: approval.approvalId,
        decision,
      });
    } catch (error) {
      setSent(null);
      toast({
        type: "error",
        title: "The answer was not recorded",
        description: (error as Error).message,
      });
    }
  };
  const deciders = approval.deciderIds.map((id) => firstName(memberName(id)));
  const toCard = () => {
    const card = document.querySelector<HTMLElement>(
      `[data-session-card="${approval.sessionId}"]`,
    );
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };
  return (
    <article
      aria-label={`${approval.agentName} asks for approval`}
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
          <span className="text-muted-foreground">Asks to approve </span>
          <span className="font-medium">{approval.title}</span>
          {approval.tool && (
            <span className="text-muted-foreground">
              {" "}
              (<code className="font-mono text-xs">{approval.tool}</code>)
            </span>
          )}
        </p>
        {pending ? (
          onCard ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {mayDecide
                ? "Review it with its context on the session card."
                : `${deciders.join(" or ")} decides.`}
              {mayDecide && (
                <button
                  type="button"
                  onClick={toCard}
                  className="rounded-sm font-medium text-foreground underline-offset-2 focus-ring outline-none hover:underline"
                >
                  Go to the card
                </button>
              )}
            </p>
          ) : mayDecide ? (
            <div className="mt-2 flex gap-2">
              <Button
                disabled={sent !== null}
                onClick={() => void answer("approve")}
              >
                <Check className="size-3.5" aria-hidden /> Approve
              </Button>
              <Button
                variant="secondary"
                disabled={sent !== null}
                onClick={() => void answer("deny")}
              >
                <X className="size-3.5" aria-hidden /> Deny
              </Button>
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
