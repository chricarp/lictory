"use client";
import { useState } from "react";
import {
  Check,
  CircleDot,
  FileDiff,
  GitMerge,
  GitPullRequestDraft,
  MessageSquareWarning,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import type { EntityOf } from "~/sync/shared/protocol";
import { Avatar, Badge, SectionLabel } from "~/components/ui/primitives";
import { diffStats } from "~/components/items/diff";
import { useItem } from "~/components/items/item-context";

// Everything a row or header needs to say about where a suggestion stands.
export function useSuggestionState(suggestion: EntityOf<"suggestion">) {
  const {
    current,
    suggestionReviewers,
    suggestionDecisions,
    suggestionThreads,
  } = useItem();
  const reviewers = suggestionReviewers.filter(
    (r) => r.suggestionId === suggestion.id && !r.withdrawnAt,
  );
  const decisions = suggestionDecisions.filter(
    (d) => d.suggestionId === suggestion.id && !d.supersededAt,
  );
  const approvals = decisions.filter(
    (d) =>
      d.decision === "approved" &&
      d.version === suggestion.version &&
      reviewers.some((r) => r.userId === d.reviewerId),
  );
  const changesRequested = decisions.filter(
    (d) =>
      d.decision === "changes_requested" && d.version === suggestion.version,
  );
  const blocking = suggestionThreads.filter(
    (t) =>
      t.suggestionId === suggestion.id && t.status === "open" && t.blocking,
  );
  const settled =
    suggestion.status === "merged" || suggestion.status === "closed";
  const outdated =
    !settled && Boolean(current) && suggestion.revisionId !== current!.id;
  return {
    reviewers,
    decisions,
    approvals,
    changesRequested,
    blocking,
    outdated,
    settled,
    mergeable:
      suggestion.status === "open" &&
      !outdated &&
      approvals.length > 0 &&
      blocking.length === 0,
  };
}

export function SuggestionStatusBadge({
  suggestion,
}: {
  suggestion: EntityOf<"suggestion">;
}) {
  const { revisionNumber, current } = useItem();
  const { outdated, approvals, changesRequested, mergeable } =
    useSuggestionState(suggestion);
  if (suggestion.status === "merged")
    return (
      <Badge tone="good">
        <GitMerge className="size-3" /> Merged as revision{" "}
        {revisionNumber(suggestion.mergedRevisionId ?? "") ?? ""}
      </Badge>
    );
  if (suggestion.status === "closed")
    return (
      <Badge>
        <X className="size-3" /> Closed
      </Badge>
    );
  if (suggestion.status === "draft")
    return (
      <Badge>
        <GitPullRequestDraft className="size-3" /> Draft
      </Badge>
    );
  if (outdated)
    return (
      <Badge tone="warning">
        Outdated · revision {current?.number} is current
      </Badge>
    );
  if (changesRequested.length)
    return (
      <Badge tone="warning">
        <MessageSquareWarning className="size-3" /> Changes requested
      </Badge>
    );
  if (mergeable)
    return (
      <Badge tone="good">
        <Check className="size-3" /> Approved · ready to merge
      </Badge>
    );
  if (approvals.length)
    return (
      <Badge tone="good">
        <Check className="size-3" /> Approved
      </Badge>
    );
  return (
    <Badge tone="info">
      <CircleDot className="size-3" /> Open for review
    </Badge>
  );
}

// Suggestions are reviewed like pull requests: each row is one proposed
// change with its reviewers and where it stands. Opening a row shows the diff,
// discussion, decisions and merge controls.
export function Suggestions({ onOpen }: { onOpen: (id: string) => void }) {
  const { suggestions } = useItem();
  const [showSettled, setShowSettled] = useState(false);
  const active = suggestions.filter(
    (s) => s.status === "open" || s.status === "draft",
  );
  const settled = suggestions.filter(
    (s) => s.status === "merged" || s.status === "closed",
  );
  if (suggestions.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Suggestions</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {active.length} open
        </span>
        {settled.length > 0 && (
          <button
            onClick={() => setShowSettled((v) => !v)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            {showSettled ? "Hide" : "Show"} {settled.length} merged or closed
          </button>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {[...active, ...(showSettled ? settled : [])].map((s) => (
          <SuggestionRow key={s.id} suggestion={s} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  onOpen,
}: {
  suggestion: EntityOf<"suggestion">;
  onOpen: (id: string) => void;
}) {
  const { revisions, memberName, revisionNumber, suggestionThreads } =
    useItem();
  const { reviewers, approvals, settled } = useSuggestionState(suggestion);
  const target = revisions.find((r) => r.id === suggestion.revisionId);
  const stats = diffStats(target?.content ?? "", suggestion.replacement);
  const open = suggestionThreads.filter(
    (t) => t.suggestionId === suggestion.id && t.status === "open",
  ).length;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(suggestion.id)}
        className={cn(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[13px] hover:bg-muted/50",
          settled && "opacity-75",
        )}
      >
        <FileDiff className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {suggestion.rationale ?? "Proposed change"}
        </span>
        <SuggestionStatusBadge suggestion={suggestion} />
        <span className="flex w-full items-center gap-2 pl-7 text-xs text-muted-foreground">
          <Avatar name={memberName(suggestion.authorId)} size="xs" />
          {memberName(suggestion.authorId)}
          <span>· {relativeTime(suggestion.updatedAt)}</span>
          <span>
            · v{suggestion.version} against revision{" "}
            {revisionNumber(suggestion.revisionId) ?? "?"}
          </span>
          <span className="tabular-nums">
            <span className="text-emerald-700">+{stats.added}</span>{" "}
            <span className="text-red-700">−{stats.removed}</span>
          </span>
          {open > 0 && (
            <span>
              · {open} open discussion{open > 1 ? "s" : ""}
            </span>
          )}
          {reviewers.length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              {reviewers.map((r) => (
                <Avatar
                  key={r.id}
                  name={memberName(r.userId)}
                  size="xs"
                  className={cn(
                    approvals.some((a) => a.reviewerId === r.userId) &&
                      "ring-2 ring-emerald-500",
                  )}
                />
              ))}
              <span className="tabular-nums">
                {approvals.length}/{reviewers.length} approved
              </span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
