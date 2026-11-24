import { sessionTitle } from "@lictory/core/factory/entities";
import {
  CircleCheckBig,
  ClipboardCheck,
  FileCheck2,
  Bot,
  MessagesSquare,
} from "lucide-react";
import type { DoneEvaluationEntity } from "@lictory/core/claims/contracts";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  identifier,
  refinementMeta,
  type Project,
} from "@lictory/core/lib/work-items";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";
import { Link } from "@lictory/platform/lib/navigation";
import { sessionState } from "@lictory/platform/lib/session-state";
import {
  useItemView,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import {
  useFactory,
  useSession,
} from "@lictory/platform/components/factory/store";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  AgentActor,
  AgentAvatar,
} from "@lictory/platform/components/identity/actor";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import { shortSha } from "@lictory/platform/components/code/parts";

// Beside a code pull request, the evidence a person merges on: what the
// linked work is and whether it was agreed (readiness, the accepted
// revision), where it stands against its Definition of Done, and, for an
// agent's change, the session that wrote it. Everything is read from
// synchronized state; nothing here is the agent's own report.

export function PullRequestEvidence({ pr }: { pr: CodePullRequestEntity }) {
  const { items, projects } = useWorkspace();
  const linked = pr.links.flatMap((link) => {
    const item = items.find((i) => i.id === link.workItemId);
    const project = projects.find((p) => p.id === link.projectId);
    return item && project ? [{ item, project }] : [];
  });
  return (
    <>
      {pr.agentSessionId && <AgentSession sessionId={pr.agentSessionId} />}
      <Panel
        title="Delivers"
        icon={<FileCheck2 />}
        count={linked.length}
        empty="Not linked to a work item. Name its key (PAY-142) in the title, description or branch, or link it from the item."
      >
        {linked.map(({ item, project }) => (
          <LinkedItem key={item.id} item={item} project={project} />
        ))}
      </Panel>
      <LictoryReviews pr={pr} />
    </>
  );
}

// The facts a merge rests on, always in the same four rows, each saying
// "not yet" rather than disappearing: delivery status, the specification
// (the item's own, or its parent's for a Task or Subtask) with its
// readiness, the accepted revision, and the Definition of Done.
function LinkedItem({ item, project }: { item: WorkItem; project: Project }) {
  const { organization, items, projects, delivery } = useWorkspace();
  // The item's own rows (its Definition of Done evaluation) load with it.
  const { entities } = useItemView(item.id);
  const done = entities.find(
    (e): e is DoneEvaluationEntity =>
      e.type === "doneEvaluation" && e.workItemId === item.id,
  );
  const key = identifier(project, item.number);
  const status = delivery.statuses.get(item.statusId);
  const parent =
    !item.refinementState && item.parentId
      ? items.find((i) => i.id === item.parentId)
      : undefined;
  const spec = item.refinementState
    ? item
    : parent?.refinementState
      ? parent
      : undefined;
  const specKey =
    spec && spec !== item
      ? identifier(
          projects.find((p) => p.id === spec.projectId),
          spec.number,
        )
      : null;
  const ready = spec?.refinementState === "ready";
  const passedDone = done?.checks.filter((c) => c.passed).length ?? 0;
  const muted = "text-muted-foreground";
  return (
    <li className="px-3.5 py-3">
      <Link
        href={paths.item(organization.slug, project.key, key)}
        className="flex min-w-0 items-baseline gap-2 rounded-sm text-[13px] leading-5 focus-ring outline-none hover:underline"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {key}
        </span>
        <span className="min-w-0 truncate font-medium">{item.title}</span>
      </Link>
      <dl className="mt-2 grid gap-1.5 text-xs">
        {status && (
          <Fact label="Status">
            <StatusChip
              tone={
                status.category === "done"
                  ? "success"
                  : status.category === "started"
                    ? "info"
                    : "neutral"
              }
              icon={<StatusDot />}
            >
              {status.name}
            </StatusChip>
          </Fact>
        )}
        <Fact label="Specification">
          {spec?.refinementState ? (
            <StatusChip
              tone={ready ? "success" : "attention"}
              icon={<ClipboardCheck />}
              title={`${spec.readinessPassed} of ${spec.readinessTotal} readiness checks pass${specKey ? ` on ${specKey}, which this item belongs to` : ""}`}
            >
              {specKey ? `${specKey} · ` : ""}
              {refinementMeta[spec.refinementState].label} ·{" "}
              {spec.readinessPassed}/{spec.readinessTotal}
            </StatusChip>
          ) : (
            <span className={muted}>None for this item</span>
          )}
        </Fact>
        {spec && (
          <Fact label="Accepted">
            {spec.committedRevisionNumber != null ? (
              <>
                <span>Revision {spec.committedRevisionNumber}</span>
                {spec.committedRevisionId !== spec.revisionId && (
                  <span className={muted}>
                    &nbsp;· now {spec.revisionNumber}
                  </span>
                )}
              </>
            ) : (
              <span className={muted}>No revision accepted yet</span>
            )}
          </Fact>
        )}
        <Fact label="Done">
          {done && done.checks.length > 0 ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="tabular-nums">
                {passedDone} of {done.checks.length}
              </span>
              <span aria-hidden className="flex max-w-24 flex-1 gap-0.5">
                {done.checks.map((c) => (
                  <span
                    key={c.key}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      c.passed ? "bg-success" : "bg-foreground/12",
                    )}
                  />
                ))}
              </span>
            </span>
          ) : (
            <span className={muted}>Checked once work on it starts</span>
          )}
        </Fact>
      </dl>
      {done && done.checks.some((c) => !c.passed) && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {done.checks
            .filter((c) => !c.passed)
            .map((c) => (
              <li key={c.key} className="truncate" title={c.detail}>
                Not yet: {c.label}
              </li>
            ))}
        </ul>
      )}
      {done?.passed && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
          <CircleCheckBig aria-hidden className="size-3.5" />
          Every Definition of Done check passes.
        </p>
      )}
    </li>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-5 items-center gap-2">
      <dt className="w-[5.5rem] shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </div>
  );
}

// The agent session that opened this change: who (the agent and the
// person it acts for) and where it stands.
function AgentSession({ sessionId }: { sessionId: string }) {
  const { organization, memberName } = useWorkspace();
  const { session } = useSession(sessionId);
  const { agentById } = useFactory();
  if (!session) return null;
  const agent = agentById.get(session.agentId);
  return (
    <Panel title="Agent session" icon={<Bot />}>
      <ListRow
        href={factoryPaths.session(organization.slug, session.id)}
        leading={agent ? <AgentAvatar agent={agent} size={20} /> : undefined}
        title={sessionTitle(session.title)}
        meta={
          <AgentActor agent={agent} ownerId={agent?.ownerId} avatar={false} />
        }
        chips={
          <SessionStateChip
            state={sessionState(session, {
              decider: memberName(agent?.ownerId ?? session.requestedById),
            })}
          />
        }
      />
    </Panel>
  );
}

// Reviews recorded in Lictory (agents' reviews), bound to the head commit
// they read: a review of an older head no longer counts.
function LictoryReviews({ pr }: { pr: CodePullRequestEntity }) {
  const { agentById } = useFactory();
  return (
    <Panel
      title="Reviews in Lictory"
      icon={<MessagesSquare />}
      count={pr.reviews.length}
    >
      {pr.reviews.map((review) => {
        const agent = review.agentId ? agentById.get(review.agentId) : null;
        return (
          <li key={review.id} className="px-3.5 py-2.5 text-[13px] leading-5">
            <p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              {agent ? (
                <AgentActor
                  agent={agent}
                  ownerId={review.reviewerId}
                  size={16}
                />
              ) : (
                <ReviewerName id={review.reviewerId} name={review.agentName} />
              )}
              <span className="text-muted-foreground">
                {review.decision === "approve"
                  ? "approved"
                  : "requested changes"}
              </span>
              <code className="font-mono text-xs text-muted-foreground">
                {shortSha(review.headSha)}
              </code>
              {!review.current && (
                <span className="text-xs text-muted-foreground">
                  · an older head
                </span>
              )}
            </p>
            {review.body && (
              <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">
                {review.body}
              </p>
            )}
          </li>
        );
      })}
    </Panel>
  );
}

function ReviewerName({ id, name }: { id: string; name: string | null }) {
  const { memberName } = useWorkspace();
  return (
    <span className="font-medium">
      {name ? `${name} via ${memberName(id)}` : memberName(id)}
    </span>
  );
}
