import type { ClaimEntity } from "@lictory/core/claims/contracts";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  AgentActor,
  type ActorSize,
  type AgentIdentity,
} from "@lictory/platform/components/identity/actor";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import {
  claimBadgeLabel,
  claimFor,
  claimShownState,
  claimState,
} from "@lictory/platform/components/claims/claim-state";
import {
  useAgents,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import { AssigneePicker } from "@lictory/platform/components/ui/people-picker";

// The compact "an agent holds this" mark on board cards, backlog rows and
// the queue, in the shared state vocabulary: "Forge · running", or, when
// its session waits on an approval, "Forge · waiting on Ada" in the
// attention tone. `data-claim` names the shown state for tests.
export function ClaimBadge({
  claim,
  assigneeId,
  withAgent = true,
  compactOnPhone = false,
  className,
}: {
  claim: ClaimEntity;
  // Whose item it is, when an agent holds work assigned to someone else.
  assigneeId?: string | null;
  // Name the agent ("Forge · waiting on Ada"); off where an owner line
  // beside the badge already names it ("Waiting on Ada").
  withAgent?: boolean;
  // In narrow rows on phones, only the state's icon and the agent's
  // initial ("✋ F"); the full label stays the accessible name.
  compactOnPhone?: boolean;
  className?: string;
}) {
  const { memberName } = useWorkspace();
  const owner = memberName(claim.ownerId);
  const state = claimState(claim, owner);
  const forWhom = claimFor(claim, assigneeId, memberName);
  const label = withAgent ? claimBadgeLabel(claim, owner) : state.label;
  const meaning = `${claim.agentName} via ${owner}${forWhom ? `, ${forWhom}` : ""}. ${state.label}: ${state.meaning}`;
  return (
    <span
      data-claim={claimShownState(claim)}
      className={cn("inline-flex max-w-48 min-w-0", className)}
    >
      <SessionStateChip
        state={{ ...state, label, meaning }}
        className={cn(
          "max-w-full min-w-0 shrink",
          compactOnPhone && "max-sm:hidden",
        )}
      />
      {compactOnPhone && (
        <span className="contents sm:hidden">
          <span aria-hidden className="contents">
            <SessionStateChip
              state={{
                ...state,
                label: Array.from(claim.agentName)[0]?.toUpperCase() ?? "",
                meaning,
              }}
            />
          </span>
          <span className="sr-only">{label}</span>
        </span>
      )}
    </span>
  );
}

// One owner line for an item an agent works: "Forge via Ada", and when the
// item is assigned to someone else, "Forge via Ada, for Ben". It replaces the
// assignee's avatar beside the claim, so the item never shows two owners.
export function ClaimOwner({
  claim,
  agent,
  assigneeId,
  size = 16,
  className,
}: {
  claim: ClaimEntity;
  // The agent's identity (its avatar), when the caller has it.
  agent?: AgentIdentity;
  assigneeId?: string | null;
  size?: ActorSize;
  className?: string;
}) {
  const { memberName } = useWorkspace();
  const forWhom = claimFor(claim, assigneeId, memberName);
  return (
    <span
      data-claim-owner
      className={cn("inline-flex min-w-0 items-center text-xs", className)}
    >
      <AgentActor
        agent={agent ?? { id: claim.agentId, name: claim.agentName }}
        ownerId={claim.ownerId}
        size={size}
        className="min-w-0"
      />
      {forWhom && (
        <span
          className="shrink-0 text-muted-foreground"
          title={`Assigned to ${memberName(assigneeId ?? null)}`}
        >
          ,&nbsp;{forWhom}
        </span>
      )}
    </span>
  );
}

// The Owner property of a work item. While an agent holds unassigned work,
// the agent is who works on it ("Forge via Ada"), with the picker beside it
// to assign a person: the field never says "Unassigned" under a claim.
export function OwnerField({
  itemId,
  assigneeId,
  onChange,
}: {
  itemId: string;
  assigneeId: string | null;
  onChange?: (assigneeId: string | null) => void;
}) {
  const { memberName } = useWorkspace();
  const claim = useLiveClaims().get(itemId);
  const agents = useAgents();
  if (!claim || assigneeId)
    return <AssigneePicker assigneeId={assigneeId} onChange={onChange} />;
  return (
    <span
      data-claim-worker
      title={`No person is assigned; ${claim.agentName} works on it via ${memberName(claim.ownerId)}.`}
      className="flex min-w-0 items-center gap-1"
    >
      <ClaimOwner
        claim={claim}
        agent={agents.get(claim.agentId)}
        size={20}
        className="min-w-0 px-1.5 text-[13px]"
      />
      {onChange && (
        <AssigneePicker compact assigneeId={null} onChange={onChange} />
      )}
    </span>
  );
}
