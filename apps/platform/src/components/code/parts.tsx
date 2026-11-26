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
  CodeConnectionEntity,
  CodeLinkTarget,
  CodePullRequestEntity,
} from "@lictory/core/code/entities";
import { reviewState } from "@lictory/core/code/merge-rules";
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
  none: "No checks reported",
};

export function ChecksIcon({
  state,
  label = checkWords[state],
  className,
}: {
  state: CodeChecks["state"];
  // Its words, when they differ from the state's (a skipped run); empty
  // when words beside it say the same (the icon is then decoration).
  label?: string;
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
          : // Nothing reported is not "pending": a flat dash, not a ring.
            [CircleMinus, "text-muted-foreground"];
  if (!label)
    return (
      <Icon aria-hidden className={cn("size-3.5 shrink-0", tone, className)} />
    );
  return (
    <Tooltip label={label}>
      <Icon
        role="img"
        aria-label={label}
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
      // The words say it; the icon is decoration here.
      icon={<ChecksIcon state={checks.state} label="" className="size-3" />}
    >
      {checks.state === "failure"
        ? `${failing || "Checks"} failing`
        : checks.state === "pending"
          ? `${pending || "Checks"} running`
          : checks.state === "none"
            ? "No checks"
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

// One answer to "is it reviewed?": the host's decision, unless a review
// recorded in Lictory on the head commit (a reviewer agent's or a person's,
// which the Definition of Done counts) says more. Requested changes on
// either side win.
export function reviewDecisionOf(
  host: CodePullRequestEntity["reviewDecision"],
  here: "approve" | "request_changes" | null | undefined,
): CodePullRequestEntity["reviewDecision"] {
  if (host === "changes_requested" || here === "request_changes")
    return "changes_requested";
  if (here === "approve") return "approved";
  return host;
}

// A review decision as a state chip (`reviewState` joins the host's and
// the reviews recorded in Lictory).
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

// Why the host's webhook deliveries stopped counting, when Lictory refused
// one after the last it accepted; null when nothing was refused since.
export function webhookRefusal(connection: CodeConnectionEntity) {
  const refusedAt = connection.lastWebhookRefusedAt;
  if (!refusedAt || !connection.lastWebhookRefusal) return null;
  if (connection.lastWebhookAt && connection.lastWebhookAt > refusedAt)
    return null;
  const host = providerLabels[connection.provider];
  return {
    at: refusedAt,
    text:
      connection.lastWebhookRefusal === "payload"
        ? `${host} sent a delivery that is not JSON. Set the webhook's content type to application/json.`
        : `${host} sent a delivery whose signature does not match this connection's webhook secret. Paste the secret again in the host's webhook settings, or create a new one under Settings → Code hosts.`,
  };
}

export const message = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Try again.";

// An item's open pull request on a board card or backlog row: its number,
// checks and review, so work waiting on a merge is visible where people
// plan. It moves no status: delivery status stays a person's (or the
// Definition of Done's) to change.
export function PullRequestChip({
  pullRequests,
}: {
  pullRequests: readonly CodePullRequestEntity[];
}) {
  const [pr, ...more] = pullRequests;
  if (!pr) return null;
  const review = reviewState(pr);
  const reviewWord =
    review === "approved"
      ? "approved"
      : review === "changes_requested"
        ? "changes requested"
        : null;
  const spoken = [
    `${pr.draft ? "Draft pull request" : "Pull request"} #${pr.number}`,
    checkWords[pr.checks.state].toLowerCase(),
    reviewWord ?? "not reviewed",
    more.length > 0 && `and ${more.length} more`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span
      data-pull-request-chip
      title={spoken}
      className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-1.5 text-foreground/80"
    >
      <span className="sr-only">{spoken}</span>
      <span aria-hidden className="inline-flex items-center gap-1">
        <PullRequestIcon state={pr.state} draft={pr.draft} className="size-3" />
        <span className="tabular-nums">#{pr.number}</span>
        <ChecksIcon state={pr.checks.state} label="" className="size-3" />
        {reviewWord && (
          <span
            className={
              review === "approved" ? "text-success" : "text-destructive"
            }
          >
            {review === "approved" ? "Approved" : "Changes"}
          </span>
        )}
        {more.length > 0 && <span>+{more.length}</span>}
      </span>
    </span>
  );
}
