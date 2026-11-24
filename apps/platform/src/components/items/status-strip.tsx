import type { ReactNode } from "react";
import { CircleCheck, CircleDashed, GitPullRequest } from "lucide-react";
import type {
  ClaimEntity,
  DoneEvaluationEntity,
} from "@lictory/core/claims/contracts";
import { cn } from "@lictory/core/lib/utils";
import { statusToneClass, type StatusTone } from "@lictory/ui/status-chip";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { AgentAvatar } from "@lictory/platform/components/identity/actor";
import {
  useAgents,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import {
  claimBadgeLabel,
  claimShownState,
  claimState,
  pullRequestStripPart,
} from "@lictory/platform/components/claims/claim-state";

// Where the rail's delivery evidence lives, for the strip to open at.
export type RailSection = "claim" | "done" | "code";
export const railSectionSelector: Record<RailSection, string> = {
  claim: '[data-rail-section="claim"]',
  done: '[data-rail-section="done"]',
  code: "[data-item-code]",
};

// On frames where the rail folds into a drawer, the delivery evidence (who
// holds the item, the Definition of Done, its pull request) would hide
// behind "Review & details". This strip under the next-step card says it in
// one line; each part opens the drawer at its section.
export function ItemStatusStrip({
  onOpen,
  className,
}: {
  onOpen: (section: RailSection) => void;
  className?: string;
}) {
  const { item, project, entities } = useItem();
  const claim = useLiveClaims().get(item.id);
  if (project.deliveryMode !== "native") return null;
  const evaluation = entities.find(
    (e): e is DoneEvaluationEntity =>
      e.type === "doneEvaluation" && e.workItemId === item.id,
  );
  if (!claim && !evaluation) return null;
  const checks = evaluation?.checks ?? [];
  const passed = checks.filter((c) => c.passed).length;
  const pull = pullRequestStripPart(evaluation);
  return (
    <ul
      aria-label="Delivery status"
      data-item-status-strip
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {claim && <ClaimPart claim={claim} onOpen={() => onOpen("claim")} />}
      {evaluation && checks.length > 0 && (
        <Part
          tone={passed === checks.length ? "success" : "neutral"}
          hint={`: ${passed} of ${checks.length} Definition of Done checks pass. Show them`}
          onClick={() => onOpen("done")}
        >
          {passed === checks.length ? <CircleCheck /> : <CircleDashed />}
          Done {passed}/{checks.length}
        </Part>
      )}
      {pull && (
        <Part
          tone={pull.tone}
          hint={`: ${pull.title}. Show the code`}
          onClick={() => onOpen("code")}
        >
          <GitPullRequest />
          {pull.label}
        </Part>
      )}
    </ul>
  );
}

// The claim's part reads the agent's avatar, so only a claimed item
// subscribes to the organization's agents.
function ClaimPart({
  claim,
  onOpen,
}: {
  claim: ClaimEntity;
  onOpen: () => void;
}) {
  const { memberName } = useWorkspace();
  const agent = useAgents().get(claim.agentId) ?? {
    id: claim.agentId,
    name: claim.agentName,
  };
  const owner = memberName(claim.ownerId);
  const label = claimBadgeLabel(claim, owner);
  return (
    <Part
      tone={claimState(claim, owner).tone}
      hint="Show the agent's claim"
      onClick={onOpen}
      data-claim={claimShownState(claim)}
    >
      <AgentAvatar agent={agent} size={16} />
      <span className="truncate">{label}</span>
    </Part>
  );
}

function Part({
  tone,
  hint,
  onClick,
  children,
  ...data
}: {
  tone: StatusTone;
  // Said after the visible words to assistive technology.
  hint: string;
  onClick: () => void;
  children: ReactNode;
  "data-claim"?: string;
}) {
  return (
    <li className="min-w-0" {...data}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          // A chip you can press: the chip's look at a 28px touch height.
          "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap ring-1 focus-ring outline-none ring-inset [&>svg]:size-3.5 [&>svg]:shrink-0",
          statusToneClass[tone],
        )}
      >
        {children}
        <span className="sr-only">
          {hint.startsWith(":") ? hint : `. ${hint}`}
        </span>
      </button>
    </li>
  );
}
