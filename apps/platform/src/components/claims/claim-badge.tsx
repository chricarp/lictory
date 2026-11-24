import { Bot, MessageCircleQuestion } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import type { ClaimEntity } from "@lictory/core/claims/contracts";
import { claimStateLabel } from "@lictory/platform/components/claims/claims";

// The compact "an agent holds this" mark on board cards, backlog rows and
// the queue. A waiting claim says so: it waits on people, not on the agent.
export function ClaimBadge({
  claim,
  label,
  className,
}: {
  claim: ClaimEntity;
  // "Forge via Ada"
  label: string;
  className?: string;
}) {
  const waiting = claim.state === "waiting";
  const Icon = waiting ? MessageCircleQuestion : Bot;
  return (
    <span
      data-claim={claim.state}
      title={`Claimed by ${label} · ${claimStateLabel[claim.state]}`}
      className={cn(
        "inline-flex h-5 max-w-36 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium ring-1 ring-inset",
        waiting
          ? "bg-warning/8 text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))] ring-warning/25"
          : "bg-ring/8 text-[color-mix(in_oklab,var(--ring)_80%,var(--foreground))] ring-ring/25",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{claim.agentName}</span>
      <span className="sr-only">
        {` claims this item for ${label.split(" via ")[1] ?? "its owner"}: ${claimStateLabel[claim.state]}`}
      </span>
    </span>
  );
}
