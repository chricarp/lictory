import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleX,
  Eye,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type {
  CodeChecks,
  CodeLinkTarget,
  CodePullRequestEntity,
} from "@lictory/core/code/entities";
import { cn } from "@lictory/core/lib/utils";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { Tooltip } from "@lictory/ui/tooltip";

// Small, shared pieces of the Code UI: state icons, check and review
// badges and addresses. Color carries meaning only next to words or an
// accessible label.

export const codePaths = {
  index: (org: string, tab?: "pull-requests" | "issues" | "repositories") =>
    `/${org}/code${tab && tab !== "pull-requests" ? `?tab=${tab}` : ""}`,
  pullRequest: (org: string, id: string) => `/${org}/code/pull-requests/${id}`,
};

export const providerLabels = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
} as const;

// GitLab calls them merge requests.
export const changeNoun = (provider: keyof typeof providerLabels) =>
  provider === "gitlab" ? "merge request" : "pull request";

export function PullRequestIcon({
  state,
  draft,
  className,
}: {
  state: CodePullRequestEntity["state"];
  draft?: boolean;
  className?: string;
}) {
  const [Icon, tone, label]: [LucideIcon, string, string] =
    state === "merged"
      ? [GitMerge, "text-violet-600 dark:text-violet-400", "Merged"]
      : state === "closed"
        ? [GitPullRequestClosed, "text-destructive", "Closed"]
        : draft
          ? [GitPullRequestDraft, "text-muted-foreground", "Draft"]
          : [GitPullRequest, "text-success", "Open"];
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cn("size-4 shrink-0", tone, className)}
    />
  );
}

export function TargetIcon({
  target,
  className,
}: {
  target: CodeLinkTarget;
  className?: string;
}) {
  const Icon =
    target === "branch"
      ? GitBranch
      : target === "commit"
        ? GitCommitHorizontal
        : target === "issue"
          ? CircleDot
          : GitPullRequest;
  return (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

const checkWords: Record<CodeChecks["state"], string> = {
  success: "Checks passed",
  failure: "Checks failing",
  pending: "Checks running",
  none: "No checks",
};

export function ChecksIcon({
  state,
  className,
}: {
  state: CodeChecks["state"];
  className?: string;
}) {
  const [Icon, tone]: [LucideIcon, string] =
    state === "success"
      ? [CircleCheck, "text-success"]
      : state === "failure"
        ? [CircleX, "text-destructive"]
        : state === "pending"
          ? [
              CircleDashed,
              "text-warning motion-safe:animate-spin [animation-duration:3s]",
            ]
          : [CircleDashed, "text-muted-foreground/50"];
  return (
    <Tooltip label={checkWords[state]}>
      <Icon
        role="img"
        aria-label={checkWords[state]}
        className={cn("size-3.5 shrink-0", tone, className)}
      />
    </Tooltip>
  );
}

export function ChecksBadge({ checks }: { checks: CodeChecks }) {
  const failing = checks.runs.filter((r) => r.state === "failure").length;
  const pending = checks.runs.filter((r) => r.state === "pending").length;
  const tone: StatusTone =
    checks.state === "success"
      ? "success"
      : checks.state === "failure"
        ? "danger"
        : checks.state === "pending"
          ? "info"
          : "neutral";
  return (
    <StatusChip
      tone={tone}
      icon={<ChecksIcon state={checks.state} className="size-3" />}
    >
      {checks.state === "failure"
        ? `${failing} failing`
        : checks.state === "pending"
          ? `${pending} running`
          : checkWords[checks.state]}
    </StatusChip>
  );
}

const reviewWords: Record<CodePullRequestEntity["reviewDecision"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  none: "No reviews",
};

const reviewLooks: Record<
  CodePullRequestEntity["reviewDecision"],
  [StatusTone, LucideIcon]
> = {
  approved: ["success", CircleCheck],
  changes_requested: ["danger", CircleX],
  // Waits on a reviewer.
  review_required: ["attention", Eye],
  none: ["neutral", CircleMinus],
};

// The host's review decision as a state chip.
export function ReviewBadge({
  decision,
}: {
  decision: CodePullRequestEntity["reviewDecision"];
}) {
  const [tone, Icon] = reviewLooks[decision];
  return (
    <StatusChip tone={tone} icon={<Icon />}>
      {reviewWords[decision]}
    </StatusChip>
  );
}

export const stateWords: Record<CodePullRequestEntity["state"], string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
};

export function shortSha(sha: string | null | undefined) {
  return sha ? sha.slice(0, 7) : "";
}

export const message = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Try again.";
