import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  CircleCheck,
  KanbanSquare,
  MessageCircleQuestion,
  OctagonPause,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { Claimability } from "@lictory/core/claims/claimability";
import {
  autonomyLevelMeta,
  type ClaimEntity,
} from "@lictory/core/claims/contracts";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  byRank,
  identifier,
  relativeTime,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import { MissingState } from "@lictory/ui/status-page";
import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { ClaimBadge } from "@lictory/platform/components/claims/claim-badge";
import {
  claimShownState,
  claimStateLabel,
  claimWaitsOnPeople,
  leaseLeft,
  useAgentLabel,
  useAutonomy,
  useClaimability,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import { ReleaseDialog } from "@lictory/platform/components/claims/item-panels";

type Dispatch = {
  workItemId: string;
  failures: number;
  held: boolean;
  nextAttemptAt: string;
  lastError: string;
};

// The factory's queue for one project (docs/internals/claims.md): what
// agents hold, what waits on people, what can be claimed now and what is
// blocked and why. Everything here is computed from synchronized facts with
// the server's own claimability rule, so the queue never promises what a
// claim would refuse.
export function FactoryQueue() {
  const project = useProject();
  const { organization } = useWorkspace();
  if (project.deliveryMode !== "native")
    return (
      <MissingState
        illustration="planning"
        icon={KanbanSquare}
        title={`${project.name} delivers in an external tool`}
        action={
          <Button
            variant="secondary"
            render={
              <Link href={paths.handoff(organization.slug, project.key)} />
            }
          >
            Open hand-off
          </Button>
        }
      >
        The delivery tool owns execution, so agents do not claim this
        project&apos;s work.
      </MissingState>
    );
  return <Queue project={project} />;
}

const PAGE = 50;

function Queue({ project }: { project: Project }) {
  const { items, view, organization, capabilitiesIn, canManage, userId } =
    useWorkspace();
  const claims = useLiveClaims();
  const verdictOf = useClaimability();
  const label = useAgentLabel();
  const { policy, stored } = useAutonomy(project.id);
  const [dispatch, setDispatch] = useState<Map<string, Dispatch>>(new Map());
  const [releasing, setReleasing] = useState<ClaimEntity>();
  const canAct =
    capabilitiesIn(project.id).changeProperties || canManage(project.id);
  const [dispatchVersion, setDispatchVersion] = useState(0);
  // Backoff is the dispatcher's state, not synchronized: read it again when
  // claims change or after a retry.
  useEffect(() => {
    let current = true;
    callCapability<{ items: Dispatch[] }>("getDispatchState", {
      organizationId: organization.id,
      projectId: project.id,
    })
      .then(
        (result) =>
          current &&
          setDispatch(new Map(result.items.map((d) => [d.workItemId, d]))),
      )
      .catch(() => current && setDispatch(new Map()));
    return () => {
      current = false;
    };
  }, [organization.id, project.id, claims.size, dispatchVersion]);
  const groups = useMemo(() => {
    const claimed: { item: WorkItem; claim: ClaimEntity }[] = [];
    const waiting: { item: WorkItem; claim: ClaimEntity }[] = [];
    const agreement: { item: WorkItem; verdict: Claimability }[] = [];
    const claimable: WorkItem[] = [];
    const blocked: { item: WorkItem; verdict: Claimability }[] = [];
    for (const item of [...items].sort(byRank)) {
      if (item.projectId !== project.id || item.archivedAt) continue;
      const claim = claims.get(item.id);
      if (claim) {
        (claimWaitsOnPeople(claim) ? waiting : claimed).push({ item, claim });
        continue;
      }
      const verdict = verdictOf(item);
      if (verdict.claimable) claimable.push(item);
      else if (verdict.stage === "blocked") blocked.push({ item, verdict });
      // Agreement waits on people when the specification is ready and only
      // the scope decision is missing; earlier refinement is not the
      // factory's queue.
      else if (
        verdict.stage === "needs_agreement" &&
        item.refinementState === "ready"
      )
        agreement.push({ item, verdict });
    }
    return { claimed, waiting, agreement, claimable, blocked };
  }, [items, claims, verdictOf, project.id]);
  const live = groups.claimed.length + groups.waiting.length;
  const key = (item: WorkItem) => identifier(project, item.number);
  const href = (item: WorkItem) =>
    paths.item(organization.slug, project.key, key(item));
  const retry = async (workItemId: string) => {
    await callCapability("retryDispatch", {
      organizationId: organization.id,
      workItemId,
    }).catch(() => undefined);
    setDispatchVersion((v) => v + 1);
  };
  const loading = view.status === "hydrating" && items.length === 0;
  const settings = paths.projectSettings(
    organization.slug,
    project.key,
    "autonomy",
  );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {project.name} · Factory queue
          </h1>
          <Badge tone={policy.level === "assist" ? "neutral" : "info"}>
            {autonomyLevelMeta[policy.level].label}
          </Badge>
          {policy.level !== "assist" && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {live} of {policy.maxConcurrentSessions} sessions
            </span>
          )}
          <Link
            href={settings}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Autonomy settings
          </Link>
        </header>
        <p className="text-[13px] text-muted-foreground">
          {autonomyLevelMeta[policy.level].summary}
          {stored && (
            <>
              {" "}
              Set {relativeTime(stored.updatedAt)} by{" "}
              {/* The accountable administrator. */}
              <PersonName id={stored.updatedById} />.
            </>
          )}
        </p>
        {loading ? (
          <LoadingState label="Opening the factory queue" />
        ) : (
          <>
            <Group
              title="Claimed"
              count={groups.claimed.length}
              icon={<Bot className="size-3.5 text-muted-foreground" />}
              empty="No agent holds work in this project."
            >
              {groups.claimed.map(({ item, claim }) => (
                <Row
                  key={item.id}
                  item={item}
                  label={key(item)}
                  href={href(item)}
                  meta={
                    <ClaimBadge
                      claim={claim}
                      label={label(claim, item.assigneeId)}
                    />
                  }
                  detail={
                    claim.lastProgress
                      ? `${claim.lastProgress} · ${relativeTime(claim.lastProgressAt ?? claim.claimedAt)}`
                      : `${label(claim, item.assigneeId)} · ${claimStateLabel[claimShownState(claim)]}${claim.state === "active" ? ` · lease ends in ${Math.max(leaseLeft(claim), 0)} min` : ""}`
                  }
                  action={
                    (canAct || claim.ownerId === userId) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReleasing(claim)}
                      >
                        Release
                      </Button>
                    )
                  }
                />
              ))}
            </Group>
            <Group
              title="Waiting on people"
              count={groups.waiting.length + groups.agreement.length}
              icon={<MessageCircleQuestion className="size-3.5 text-warning" />}
              empty="Nothing waits on a person's answer or decision."
            >
              {groups.waiting.map(({ item, claim }) => (
                <Row
                  key={item.id}
                  item={item}
                  label={key(item)}
                  href={href(item)}
                  meta={
                    <ClaimBadge
                      claim={claim}
                      label={label(claim, item.assigneeId)}
                    />
                  }
                  detail={
                    claim.state === "waiting"
                      ? `${label(claim, item.assigneeId)} asked ${claim.waitingThreadIds.length === 1 ? "a question" : `${claim.waitingThreadIds.length} questions`} about the specification. Resolve ${claim.waitingThreadIds.length === 1 ? "it" : "them"} to resume.`
                      : `${label(claim, item.assigneeId)} waits on a person's answer in its session since ${relativeTime(claim.sessionWaitingSince ?? claim.claimedAt)}.`
                  }
                  action={
                    claim.agentSessionId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        render={
                          <Link
                            href={paths.factorySession(
                              organization.slug,
                              claim.agentSessionId,
                            )}
                          />
                        }
                      >
                        Open session
                      </Button>
                    )
                  }
                />
              ))}
              {groups.agreement.map(({ item, verdict }) => (
                <Row
                  key={item.id}
                  item={item}
                  label={key(item)}
                  href={href(item)}
                  meta={<Badge tone="warning">Accept scope</Badge>}
                  detail={verdict.reasons[0]?.message}
                />
              ))}
            </Group>
            <Group
              title="Claimable now"
              count={groups.claimable.length}
              icon={<CircleCheck className="size-3.5 text-success" />}
              empty="Nothing is claimable: work appears here once its scope is accepted and nothing blocks it."
            >
              {groups.claimable.map((item) => {
                const held = dispatch.get(item.id);
                return (
                  <Row
                    key={item.id}
                    item={item}
                    label={key(item)}
                    href={href(item)}
                    meta={
                      held &&
                      (held.held ? (
                        <Badge tone="warning">Dispatch held</Badge>
                      ) : (
                        <Badge>
                          Retrying {relativeTime(held.nextAttemptAt)}
                        </Badge>
                      ))
                    }
                    detail={
                      held
                        ? `${held.lastError} (${held.failures} failed ${held.failures === 1 ? "start" : "starts"})`
                        : undefined
                    }
                    action={
                      held &&
                      canAct && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void retry(item.id)}
                        >
                          Retry
                        </Button>
                      )
                    }
                  />
                );
              })}
            </Group>
            <Group
              title="Blocked"
              count={groups.blocked.length}
              icon={<OctagonPause className="size-3.5 text-muted-foreground" />}
              empty="Nothing agreed is blocked."
            >
              {groups.blocked.map(({ item, verdict }) => (
                <Row
                  key={item.id}
                  item={item}
                  label={key(item)}
                  href={href(item)}
                  detail={verdict.reasons.map((r) => r.message).join(" ")}
                />
              ))}
            </Group>
          </>
        )}
      </div>
      {releasing && (
        <ReleaseDialog
          claimId={releasing.id}
          agent={label(releasing)}
          onClose={() => setReleasing(undefined)}
        />
      )}
    </div>
  );
}

function PersonName({ id }: { id: string }) {
  const { memberName } = useWorkspace();
  return <span className="text-foreground">{memberName(id)}</span>;
}

function Group({
  title,
  count,
  icon,
  empty,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  empty: string;
  children: ReactNode[];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, PAGE);
  return (
    <section
      aria-label={title}
      className="rounded-xl bg-card shadow-(--shadow-border)"
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      <div className="divide-y border-t">
        {count === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted-foreground">{empty}</p>
        ) : (
          shown
        )}
        {children.length > shown.length && (
          <div className="px-4 py-2">
            <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
              Show all {children.length}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({
  item,
  label,
  href,
  meta,
  detail,
  action,
}: {
  item: WorkItem;
  label: string;
  href: string;
  meta?: ReactNode;
  detail?: string;
  action?: ReactNode;
}) {
  const { delivery } = useWorkspace();
  return (
    <div
      data-queue-item={item.id}
      className="relative flex items-center gap-2 px-4 py-2 text-[13px] hover:bg-muted/50"
    >
      <TypeIcon type={typeOf(delivery, item)} />
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate after:absolute after:inset-0"
        >
          {item.title}
        </Link>
        {detail && (
          <p className={cn("text-xs text-muted-foreground", "line-clamp-2")}>
            {detail}
          </p>
        )}
      </div>
      {meta && (
        <span className="flex shrink-0 items-center gap-1.5">{meta}</span>
      )}
      {action && <span className="relative z-10 shrink-0">{action}</span>}
    </div>
  );
}
