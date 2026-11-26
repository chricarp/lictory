import { Children, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  CircleCheck,
  ListChecks,
  MessageCircleQuestion,
  OctagonPause,
  Settings2,
  UsersRound,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { Claimability } from "@lictory/core/claims/claimability";
import {
  autonomyLevelMeta,
  type ClaimEntity,
} from "@lictory/core/claims/contracts";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import {
  byRank,
  identifier,
  relativeTime,
  typeOf,
  type Project,
} from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { StatusChip } from "@lictory/ui/status-chip";
import { MissingState } from "@lictory/ui/status-page";
import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { firstName } from "@lictory/platform/lib/session-state";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { ExternalProjectNotice } from "@lictory/platform/components/delivery/external-notice";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import {
  ClaimBadge,
  ClaimOwner,
} from "@lictory/platform/components/claims/claim-badge";
import {
  claimWaitsOnPeople,
  leaseLeft,
  useAgentLabel,
  useAutonomy,
  useClaimability,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import { ReleaseDialog } from "@lictory/platform/components/claims/item-panels";
import { useFactory } from "@lictory/platform/components/factory/store";
import { waitsForRunner } from "@lictory/core/factory/entities";

type Dispatch = {
  workItemId: string;
  failures: number;
  held: boolean;
  nextAttemptAt: string;
  lastError: string;
};

// The factory's queue for one project (docs/internals/claims.md): what
// agents hold, what waits on people, what can be claimed now, what is left
// to people who already do it, and what is blocked and why. Everything here
// is computed from synchronized facts with the server's own claimability
// rule, so the queue never promises what a claim would refuse.
export function FactoryQueue() {
  const project = useProject();
  const { directory } = useWorkspace();
  const tool = projectDeliveryTool(directory, project.id);
  if (project.deliveryMode !== "native")
    return (
      <ExternalProjectNotice
        project={project}
        surface="factory queue"
        title="Factory queue"
        icon={<ListChecks />}
      >
        {tool.Name} owns delivery in this project, so agents never claim or get
        dispatched its work: claims, Build and Autopilot need a project that
        delivers in Lictory. Refinement, reviews and the hand-off work as usual.
      </ExternalProjectNotice>
    );
  return <Queue project={project} />;
}

const PAGE = 50;

function Queue({ project }: { project: Project }) {
  const {
    items,
    view,
    organization,
    capabilitiesIn,
    canManage,
    userId,
    memberName,
    delivery,
  } = useWorkspace();
  const { agentById, runnerById, runners, sessions } = useFactory();
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
  // A claim whose session no online runner can take waits silently
  // otherwise: its row says so.
  const noRunner = (claim: ClaimEntity) => {
    if (claim.state !== "starting" || !claim.agentSessionId) return false;
    const session = sessions.find((s) => s.id === claim.agentSessionId);
    return Boolean(
      session &&
      waitsForRunner(session, agentById.get(session.agentId), runners),
    );
  };
  // Work a person owns stays theirs: the dispatcher gives an assigned item
  // only to an implementer acting for its assignee.
  const implementerOwners = new Set(
    policy.implementerAgentIds.map((id) => agentById.get(id)?.ownerId),
  );
  const leftTo = (item: WorkItem) =>
    policy.level !== "assist" &&
    item.assigneeId &&
    !implementerOwners.has(item.assigneeId)
      ? `Assigned to ${memberName(item.assigneeId)}: the ${autonomyLevelMeta[policy.level].label} policy leaves it to them.`
      : undefined;
  // Work people already do, apart from what is blocked: an item the
  // policy leaves to its assignee, or one a person's pull request covers.
  // The strongest reason leads: whose it is, then the pull request, then
  // anything else that would also have to clear.
  const peopleOwn: { item: WorkItem; reason: string }[] = [];
  const claimableNow: WorkItem[] = [];
  const blockedNow: { item: WorkItem; reason: string }[] = [];
  for (const item of groups.claimable) {
    const why = leftTo(item);
    if (why) peopleOwn.push({ item, reason: why });
    else claimableNow.push(item);
  }
  for (const { item, verdict } of groups.blocked) {
    const linked = verdict.reasons.filter(
      (r) => r.code === "pull_request_linked",
    );
    if (!linked.length) {
      blockedNow.push({
        item,
        reason: verdict.reasons.map((r) => r.message).join(" "),
      });
      continue;
    }
    peopleOwn.push({
      item,
      reason: [
        ...(item.assigneeId
          ? [`Assigned to ${memberName(item.assigneeId)}.`]
          : []),
        ...linked,
        ...verdict.reasons.filter((r) => r.code !== "pull_request_linked"),
      ]
        .map((r) => (typeof r === "string" ? r : r.message))
        .join(" "),
    });
  }
  // Long reasons wrap to a second line on phones instead of being cut.
  const reasonText = (reason?: string) =>
    reason && (
      <span className="min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal">
        {reason}
      </span>
    );
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
  const sessionById = new Map(sessions.map((x) => [x.id, x]));
  const level = autonomyLevelMeta[policy.level];
  const nothing =
    live +
      groups.agreement.length +
      groups.claimable.length +
      groups.blocked.length ===
    0;
  const header = (
    <PageHeader
      title="Factory queue"
      icon={<ListChecks />}
      breadcrumbs={[
        {
          label: project.name,
          href: paths.project(organization.slug, project.key),
        },
      ]}
      description={`${level.summary}${stored ? ` Set ${relativeTime(stored.updatedAt)} by ${memberName(stored.updatedById)}.` : ""}`}
      meta={
        <>
          <StatusChip tone={policy.level === "assist" ? "neutral" : "info"}>
            {level.label}
          </StatusChip>
          {policy.level !== "assist" && (
            <span className="tabular-nums">
              {live} of {policy.maxConcurrentSessions} sessions
            </span>
          )}
        </>
      }
      actions={
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={settings} />}
          aria-label="Autonomy settings"
        >
          <Settings2 className="size-3.5" />
          <span className="max-sm:hidden">Autonomy settings</span>
        </Button>
      }
    />
  );
  if (loading)
    return (
      <div className="flex h-full flex-col">
        {header}
        <LoadingState label="Opening the factory queue" />
      </div>
    );
  if (nothing)
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {policy.level === "assist" ? (
            <MissingState
              headingLevel={2}
              illustration="planning"
              icon={Bot}
              title="Agents work here when asked"
              action={
                <Button variant="secondary" render={<Link href={settings} />}>
                  Autonomy settings
                </Button>
              }
            >
              {project.name} is on Assist: agents claim work only when a person
              asks them. With Build, Lictory dispatches ready work to
              implementer agents in rank order and people merge their pull
              requests; Autopilot also merges them when every required check
              passes.
            </MissingState>
          ) : (
            <MissingState
              headingLevel={2}
              illustration="planning"
              icon={Bot}
              title="Nothing to dispatch yet"
              action={
                <Button
                  variant="secondary"
                  render={
                    <Link
                      href={paths.backlog(organization.slug, project.key)}
                    />
                  }
                >
                  Open the backlog
                </Button>
              }
            >
              Work appears here once its specification is ready and its scope is
              accepted; {level.label} then dispatches it to{" "}
              {policy.implementerAgentIds.length === 1
                ? "the implementer agent"
                : "implementer agents"}{" "}
              in rank order.
            </MissingState>
          )}
        </div>
      </div>
    );
  const typeIcon = (item: WorkItem) => (
    <TypeIcon type={typeOf(delivery, item)} />
  );
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
          <Group
            title="Waiting on people"
            icon={<MessageCircleQuestion />}
            count={groups.waiting.length + groups.agreement.length}
          >
            {groups.waiting.map(({ item, claim }) => {
              const session = claim.agentSessionId
                ? sessionById.get(claim.agentSessionId)
                : undefined;
              const approval = session?.approvals[0];
              // An approval request reads the same as on Home and in the
              // Factory: what is asked, by whom, with Review to open the
              // evidence before deciding.
              if (session && approval && claim.sessionWaitingSince)
                return (
                  <ApprovalRequest
                    key={item.id}
                    compact
                    session={session}
                    approval={approval}
                    agent={agentById.get(session.agentId)}
                    runner={
                      session.runnerId
                        ? runnerById.get(session.runnerId)
                        : undefined
                    }
                  />
                );
              return (
                <ListRow
                  key={item.id}
                  href={href(item)}
                  leading={typeIcon(item)}
                  identifier={key(item)}
                  title={item.title}
                  meta={
                    claim.state === "waiting" || claim.waitingThreadIds.length
                      ? `${claim.agentName} asked ${claim.waitingThreadIds.length === 1 ? "a question" : `${claim.waitingThreadIds.length} questions`} about the specification. Resolve ${claim.waitingThreadIds.length === 1 ? "it" : "them"} to resume.`
                      : `${claim.agentName} waits on ${firstName(memberName(claim.ownerId))}'s answer since ${relativeTime(claim.sessionWaitingSince ?? claim.claimedAt)}.`
                  }
                  chips={
                    <ClaimBadge claim={claim} assigneeId={item.assigneeId} />
                  }
                  actions={
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
              );
            })}
            {groups.agreement.map(({ item, verdict }) => (
              <ListRow
                key={item.id}
                href={href(item)}
                leading={typeIcon(item)}
                identifier={key(item)}
                title={item.title}
                meta={reasonText(verdict.reasons[0]?.message)}
                chips={<StatusChip tone="attention">Accept scope</StatusChip>}
              />
            ))}
          </Group>
          <Group title="Claimed" icon={<Bot />} count={groups.claimed.length}>
            {groups.claimed.map(({ item, claim }) => (
              <ListRow
                key={item.id}
                href={href(item)}
                leading={typeIcon(item)}
                identifier={key(item)}
                title={item.title}
                meta={
                  <>
                    <ClaimOwner
                      claim={claim}
                      agent={agentById.get(claim.agentId)}
                      assigneeId={item.assigneeId}
                      className="shrink-0"
                    />
                    <span aria-hidden>·</span>
                    <span className="min-w-0 truncate">
                      {noRunner(claim)
                        ? `Queued: no online runner can run ${agentById.get(claim.agentId)?.name ?? "its agent"}`
                        : claim.lastProgress
                          ? `${claim.lastProgress} · ${relativeTime(claim.lastProgressAt ?? claim.claimedAt)}`
                          : claim.state === "active"
                            ? `Lease ends in ${Math.max(leaseLeft(claim), 0)} min`
                            : `Claimed ${relativeTime(claim.claimedAt)}`}
                    </span>
                  </>
                }
                chips={
                  <ClaimBadge claim={claim} assigneeId={item.assigneeId} />
                }
                actions={
                  (canAct || claim.ownerId === userId) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setReleasing(claim)}
                    >
                      Release claim…
                    </Button>
                  )
                }
              />
            ))}
          </Group>
          <Group
            title="Claimable now"
            icon={<CircleCheck />}
            count={claimableNow.length}
          >
            {claimableNow.map((item) => {
              const held = dispatch.get(item.id);
              return (
                <ListRow
                  key={item.id}
                  href={href(item)}
                  leading={typeIcon(item)}
                  identifier={key(item)}
                  title={item.title}
                  meta={
                    held &&
                    reasonText(
                      `${held.lastError} (${held.failures} failed ${held.failures === 1 ? "start" : "starts"})`,
                    )
                  }
                  chips={
                    held &&
                    (held.held ? (
                      <StatusChip tone="attention">Dispatch held</StatusChip>
                    ) : (
                      <StatusChip>
                        Retrying {relativeTime(held.nextAttemptAt)}
                      </StatusChip>
                    ))
                  }
                  actions={
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
            title="Left to people"
            icon={<UsersRound />}
            count={peopleOwn.length}
          >
            {peopleOwn.map(({ item, reason }) => (
              <ListRow
                key={item.id}
                href={href(item)}
                leading={typeIcon(item)}
                identifier={key(item)}
                title={item.title}
                meta={reasonText(reason)}
              />
            ))}
          </Group>
          <Group
            title="Blocked"
            icon={<OctagonPause />}
            count={blockedNow.length}
          >
            {blockedNow.map(({ item, reason }) => (
              <ListRow
                key={item.id}
                href={href(item)}
                leading={typeIcon(item)}
                identifier={key(item)}
                title={item.title}
                meta={reasonText(reason)}
              />
            ))}
          </Group>
        </div>
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

// A panel of the queue. Empty groups are not shown (the page says when
// nothing at all is queued); long ones show the first page of rows.
function Group({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const rows = Children.toArray(children);
  const shown = all ? rows : rows.slice(0, PAGE);
  return (
    <Panel title={title} icon={icon} count={count}>
      {rows.length > 0 && shown}
      {rows.length > shown.length && (
        <li className="px-3.5 py-2">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show all {rows.length}
          </Button>
        </li>
      )}
    </Panel>
  );
}
