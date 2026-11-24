import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  ShieldQuestion,
  X,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { SessionStatus } from "@lictory/core/factory/entities";
import type {
  ApprovalCardPayload,
  QuestionCardPayload,
  SessionCardPayload,
} from "@lictory/core/factory/session-cards";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { ReferenceChip } from "@lictory/platform/components/references/chips";
import { useSession } from "@lictory/platform/components/factory/store";
import {
  statusLabels,
  statusMeaning,
  statusTone,
} from "@lictory/platform/components/factory/labels";

// What the Factory writes into a channel thread
// (docs/internals/factory.md#sessions-in-channels): a session's live card,
// an approval request with Approve and Deny for the people who may decide,
// and an agent's question pointing at the anchored discussion. The card's
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

function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span title={statusMeaning(status)}>
      <Badge tone={statusTone[status]}>
        {(status === "running" || status === "assigned") && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
          />
        )}
        {statusLabels[status]}
      </Badge>
    </span>
  );
}

const cardClass =
  "mt-0.5 max-w-xl rounded-lg border bg-card px-3 py-2 text-[13px] shadow-xs";

export function FactoryCard({ payload }: { payload: FactoryCardPayload }) {
  if (payload.type === "agentSession") return <SessionCard card={payload} />;
  if (payload.type === "agentApproval") return <ApprovalCard card={payload} />;
  return <QuestionCard card={payload} />;
}

function SessionCard({ card }: { card: SessionCardPayload }) {
  const { session } = useSession(card.sessionId);
  const status = session?.status ?? card.status;
  const summary = session?.resultSummary ?? card.summary;
  const error = session?.error ?? card.error;
  const title = session?.title ?? card.title;
  return (
    <section aria-label={`${card.agentName} session`} className={cardClass}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {card.workItemId && card.workItemKey && (
          <ReferenceChip
            target={{ kind: "item", id: card.workItemId }}
            label={card.workItemKey}
          />
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          render={<Link href={card.path} />}
        >
          Open session <ArrowUpRight className="size-3.5" aria-hidden />
        </Button>
      </div>
      <p className="mt-1 font-medium">{title}</p>
      {status === "completed" && summary && (
        <p className="mt-1 line-clamp-3 text-muted-foreground">{summary}</p>
      )}
      {status === "failed" && error && (
        <p className="mt-1 line-clamp-3 text-destructive">{error}</p>
      )}
    </section>
  );
}

function ApprovalCard({ card: approval }: { card: ApprovalCardPayload }) {
  const { organization, userId, memberName } = useWorkspace();
  const [sent, setSent] = useState<"approve" | "deny" | null>(null);
  const pending = approval.status === "pending";
  const mayDecide = approval.deciderIds.includes(userId);
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
  const deciders = approval.deciderIds.map((id) => memberName(id));
  return (
    <section
      aria-label={`${approval.agentName} asks for approval`}
      className={cardClass}
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Approval requested
          </p>
          <p className="font-medium">{approval.title}</p>
          {approval.tool && (
            <p className="text-[12px] text-muted-foreground">
              Tool: <code className="font-mono">{approval.tool}</code>
            </p>
          )}
          {pending ? (
            mayDecide ? (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  disabled={sent !== null}
                  onClick={() => void answer("approve")}
                >
                  <Check className="size-3.5" aria-hidden /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={sent !== null}
                  onClick={() => void answer("deny")}
                >
                  <X className="size-3.5" aria-hidden /> Deny
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {deciders.join(" or ")} can decide.
              </p>
            )
          ) : (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {approval.status === "approved"
                ? `Approved by ${memberName(approval.decidedById)}`
                : approval.status === "denied"
                  ? `Denied by ${memberName(approval.decidedById)}`
                  : "Expired: the session ended before anyone answered."}
              {approval.note ? `: “${approval.note}”` : ""}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function QuestionCard({ card: question }: { card: QuestionCardPayload }) {
  const { memberName } = useWorkspace();
  const resolved = question.status === "resolved";
  return (
    <section
      aria-label={`${question.agentName} asks a question`}
      className={cardClass}
    >
      <div className="flex items-start gap-2">
        <CircleHelp
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {resolved ? "Question resolved" : "Question"} ·{" "}
            <ReferenceChip
              target={{ kind: "item", id: question.questionItemId }}
              label={question.questionItemKey}
            />
          </p>
          <p className="mt-0.5">{question.question}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {resolved
              ? `Resolved by ${memberName(question.resolvedById)}; ${question.agentName} continues.`
              : `${question.itemKey} waits for the answer.`}
          </p>
          {!resolved && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              render={<Link href={question.path} />}
            >
              Answer in the discussion
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
