import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  FileDiff,
  GitMerge,
  Loader2,
  MessageSquare,
} from "lucide-react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { Tabs, TabsPanel } from "@ui-sdk/react/tabs";
import { callCapability } from "@lictory/core/capabilities/client";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";
import { mergeBlockers } from "@lictory/core/code/merge-rules";
import type { CodePullRequestFile } from "@lictory/core/code/provider";
import { codePullRequest } from "@lictory/core/contracts/state-machines";
import { cn } from "@lictory/core/lib/utils";
import { numberPatch } from "@lictory/platform/lib/patch";
import { byType, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@lictory/platform/components/editor/markdown-editor";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import {
  PullRequestHeader,
  PullRequestTabs,
} from "@lictory/platform/components/review/pull-request-header";
import {
  MergeBox,
  MergedNotice,
  type MergeRequirement,
} from "@lictory/platform/components/review/merge-box";
import { Actor, AgentActor } from "@lictory/platform/components/identity/actor";
import { CheckIcon } from "@lictory/platform/components/review/flow-ui";
import { useFactory } from "@lictory/platform/components/factory/store";
import {
  useCodeHosts,
  useCodePullRequest,
  useCodeWrites,
  useLoginOwner,
} from "@lictory/platform/components/code/store";
import {
  ChecksIcon,
  changeNoun,
  codePaths,
  message,
  providerLabels,
  shortSha,
} from "@lictory/platform/components/code/parts";
import { WriteStatus } from "@lictory/platform/components/code/write-status";
import {
  pullRequestSnapshot,
  useAnnouncePullRequests,
} from "@lictory/platform/components/code/announce";
import { PullRequestEvidence } from "@lictory/platform/components/code/pull-request-evidence";

// One pull request: what it changes (the files are read from the host when
// asked, never stored), its checks and reviews, the work it delivers, and
// what can be done with it here. Merging is a person's decision for the head
// they looked at; the host's protections apply on top.

type Files = {
  headSha: string;
  files: (CodePullRequestFile & { truncated: boolean })[];
};

export function PullRequestPage() {
  const { pr: pullRequestId = "" } = useParams<{ pr: string }>();
  const { organization } = useWorkspace();
  const { pullRequest, complete } = useCodePullRequest(pullRequestId);
  if (!pullRequest)
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title="Pull request"
          back={{
            label: "Back to Code",
            href: codePaths.index(organization.slug),
          }}
        />
        {complete ? (
          <EmptyState title="This pull request is unavailable">
            It may belong to a code host that was disconnected.{" "}
            <Link
              className="underline"
              href={codePaths.index(organization.slug)}
            >
              Back to Code
            </Link>
          </EmptyState>
        ) : (
          <LoadingState label="Loading the pull request" />
        )}
      </div>
    );
  return <PullRequestView pr={pullRequest} />;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function PullRequestView({ pr }: { pr: CodePullRequestEntity }) {
  const { organization, userId } = useWorkspace();
  const { agentById } = useFactory();
  const noun = changeNoun(pr.provider);
  // Check results and the merge are announced while the page is open.
  const snapshot = useMemo(
    () => [pullRequestSnapshot(pr, noun, userId)],
    [pr, noun, userId],
  );
  useAnnouncePullRequests(snapshot);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const agent = pr.agentId ? agentById.get(pr.agentId) : undefined;
  const author = useLoginOwner(pr.authorLogin);
  const state = pr.state === "open" && pr.draft ? ("draft" as const) : pr.state;
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={`${capital(noun)} #${pr.number}`}
        back={{
          label: "Back to Code",
          href: codePaths.index(organization.slug),
        }}
        meta={
          <span className="truncate font-mono text-xs">
            {pr.repositoryFullName}
          </span>
        }
        actions={
          // On phones the link is its icon, so the bar never wraps.
          <a
            href={pr.webUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground max-sm:size-8 max-sm:justify-center max-sm:px-0"
          >
            <span className="max-sm:sr-only">
              Open on {providerLabels[pr.provider]}
            </span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs
          value={tab}
          onValueChange={(next) => next && setTab(next)}
          className="mx-auto grid max-w-6xl gap-x-8 gap-y-6 px-4 pt-6 pb-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_19rem]"
        >
          <div className="min-w-0 space-y-6">
            <PullRequestHeader
              title={pr.title}
              state={state}
              author={
                agent ? (
                  <AgentActor agent={agent} ownerId={pr.openedById} size={20} />
                ) : (author ?? pr.openedById) ? (
                  <Actor userId={author ?? pr.openedById} size={20} />
                ) : (
                  <span>{pr.authorLogin ?? "unknown"}</span>
                )
              }
              base={pr.baseBranch}
              head={pr.headBranch}
              meta={
                <>
                  <span aria-hidden>·</span>
                  <span>
                    head{" "}
                    <code className="font-mono text-xs">
                      {shortSha(pr.headSha)}
                    </code>
                  </span>
                  <span aria-hidden>·</span>
                  <span>updated {relativeTime(pr.hostUpdatedAt)}</span>
                </>
              }
              tabs={
                <PullRequestTabs
                  label={`${capital(noun)} views`}
                  tabs={[
                    {
                      value: "conversation",
                      label: "Conversation",
                      icon: <MessageSquare aria-hidden />,
                    },
                    {
                      value: "files",
                      label: "Files changed",
                      icon: <FileDiff aria-hidden />,
                    },
                  ]}
                />
              }
            />
            <TabsPanel value="conversation" className="space-y-6">
              <section aria-label="Description">
                {pr.bodyExcerpt ? (
                  <Markdown
                    source={pr.bodyExcerpt}
                    className="text-sm leading-6"
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    No description.
                  </p>
                )}
              </section>
              <Merge pr={pr} />
              <Discussion pr={pr} />
            </TabsPanel>
            <TabsPanel value="files">
              <FilesChanged pr={pr} noun={noun} />
            </TabsPanel>
          </div>
          <aside
            aria-label="Evidence"
            className="flex min-w-0 flex-col gap-4 lg:pt-1"
          >
            <PullRequestEvidence pr={pr} />
          </aside>
        </Tabs>
      </div>
    </div>
  );
}

// The checks, reviews and conflicts the merge depends on, as requirements
// in words. `mergeBlockers` is the rule; these rows explain it. Reviews
// recorded in Lictory (an agent's, with the person it acts for) count
// beside the host's.
function requirements(
  pr: CodePullRequestEntity,
  memberName: (id: string | null) => string,
): MergeRequirement[] {
  const rows: MergeRequirement[] = [];
  if (pr.draft)
    rows.push({
      key: "draft",
      state: "failure",
      text: "It is a draft. Mark it ready for review on the code host first.",
    });
  const runs = pr.checks.runs;
  const failing = runs.filter((r) => r.state === "failure");
  const running = runs.filter((r) => r.state === "pending");
  rows.push(
    pr.checks.state === "success"
      ? {
          key: "checks",
          state: "success",
          text: "Checks passed.",
          detail: runs.length > 0 && <CheckRuns runs={runs} pr={pr} />,
        }
      : pr.checks.state === "failure"
        ? {
            key: "checks",
            state: "failure",
            text: `Checks are failing (${failing.length} of ${runs.length}).`,
            detail: <CheckRuns runs={runs} pr={pr} />,
          }
        : pr.checks.state === "pending"
          ? {
              key: "checks",
              state: "running",
              text: `Checks are still running (${running.length} of ${runs.length}).`,
              detail: <CheckRuns runs={runs} pr={pr} />,
            }
          : {
              key: "checks",
              state: "neutral",
              text: `The code host has reported no checks for ${shortSha(pr.headSha)}.`,
              detail:
                "No check is no evidence that CI passed. If this repository runs CI, wait for it to report.",
            },
  );
  const reviewer = (r: CodePullRequestEntity["reviews"][number]) =>
    r.agentName
      ? `${r.agentName} via ${memberName(r.reviewerId)}`
      : memberName(r.reviewerId);
  const current = pr.reviews.filter((r) => r.current);
  const lictoryApprovers = current
    .filter((r) => r.decision === "approve")
    .map(reviewer);
  const lictoryChanges = current
    .filter((r) => r.decision === "request_changes")
    .map(reviewer);
  const approvers = [...pr.approvedBy, ...lictoryApprovers];
  const changesNote =
    lictoryChanges.length > 0 &&
    `${lictoryChanges.join(", ")} requested changes in Lictory.`;
  rows.push(
    pr.reviewDecision === "changes_requested"
      ? {
          key: "reviews",
          state: "failure",
          text: "A reviewer requested changes.",
        }
      : approvers.length > 0
        ? {
            key: "reviews",
            state: "success",
            text:
              pr.reviewDecision === "approved"
                ? "Approved."
                : `Approved in Lictory at ${shortSha(pr.headSha)}.`,
            detail: [
              `By ${approvers.join(", ")}.`,
              pr.reviewDecision === "review_required" &&
                "The code host still asks for a review of its own.",
              changesNote,
            ]
              .filter(Boolean)
              .join(" "),
          }
        : pr.reviewDecision === "review_required"
          ? {
              key: "reviews",
              state: "pending",
              text: "A review is required.",
              detail:
                [
                  pr.requestedReviewers.length > 0 &&
                    `Asked: ${pr.requestedReviewers.join(", ")}.`,
                  changesNote,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
            }
          : {
              key: "reviews",
              state: "neutral",
              text: lictoryChanges.length
                ? "Nobody has approved this commit."
                : "Nobody has reviewed this commit.",
              detail:
                [
                  pr.requestedReviewers.length > 0 &&
                    `Asked: ${pr.requestedReviewers.join(", ")}.`,
                  changesNote,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
            },
  );
  rows.push(
    pr.mergeable === false
      ? {
          key: "conflicts",
          state: "failure",
          text: "It conflicts with its base branch.",
        }
      : pr.mergeable
        ? {
            key: "conflicts",
            state: "success",
            text: `No conflicts with ${pr.baseBranch}.`,
          }
        : {
            key: "conflicts",
            state: "neutral",
            text: "The code host has not reported conflicts yet.",
          },
  );
  return rows;
}

// Under "Ready to merge": what the evidence is, never more. Nothing blocks
// the merge, but missing evidence is named ("no checks reported").
function readySummary(
  rows: readonly MergeRequirement[],
  target: string,
): string {
  const missing: string[] = [];
  for (const r of rows) {
    if (r.state === "success") continue;
    if (r.key === "checks") missing.push("no checks were reported");
    else if (r.key === "reviews")
      missing.push(
        r.state === "pending"
          ? "the code host still requires a review"
          : "nobody approved it",
      );
    else if (r.key === "conflicts") missing.push("conflicts are not known yet");
  }
  if (!missing.length)
    return `Checks passed, it is approved and it merges cleanly into ${target}.`;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `Nothing blocks merging into ${target}, but ${list}.`;
}

// Each run links to its details on the host; a run the host gave no link
// for opens the pull request's checks there.
function CheckRuns({
  runs,
  pr,
}: {
  runs: CodePullRequestEntity["checks"]["runs"];
  pr: Pick<CodePullRequestEntity, "provider" | "webUrl">;
}) {
  const fallback = hostChecksUrl(pr);
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {runs.map((run) => (
        <li key={run.name} className="inline-flex items-center gap-1">
          <ChecksIcon
            state={run.state === "neutral" ? "none" : run.state}
            label={run.state === "neutral" ? "Skipped" : undefined}
          />
          {(run.url ?? fallback) ? (
            <a
              href={run.url ?? fallback}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm underline-offset-2 focus-ring outline-none hover:text-foreground hover:underline"
            >
              {run.name}
            </a>
          ) : (
            <span>{run.name}</span>
          )}
          {run.state === "neutral" && <span>(skipped)</span>}
        </li>
      ))}
    </ul>
  );
}

function hostChecksUrl(
  pr: Pick<CodePullRequestEntity, "provider" | "webUrl">,
): string | undefined {
  if (!pr.webUrl) return undefined;
  const base = pr.webUrl.replace(/\/$/, "");
  return pr.provider === "github"
    ? `${base}/checks`
    : pr.provider === "gitlab"
      ? `${base}/pipelines`
      : base;
}

function useCanWork(pr: CodePullRequestEntity) {
  const { capabilitiesIn } = useWorkspace();
  const { repositories } = useCodeHosts();
  const repository = repositories.find((r) => r.id === pr.repositoryId);
  return (repository?.projectIds ?? []).some(
    (id) => capabilitiesIn(id).changeProperties,
  );
}

function useCall(pr: CodePullRequestEntity) {
  const { organization } = useWorkspace();
  const [error, setError] = useState<string>();
  const call = async (name: string, input: Record<string, unknown>) => {
    setError(undefined);
    try {
      await callCapability(name, {
        organizationId: organization.id,
        pullRequestId: pr.id,
        mutationId: crypto.randomUUID(),
        ...input,
      });
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };
  return { call, error };
}

function Merge({ pr }: { pr: CodePullRequestEntity }) {
  const { memberName } = useWorkspace();
  const writes = useCodeWrites().filter((w) => w.pullRequestId === pr.id);
  const canWork = useCanWork(pr);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">(
    pr.provider === "gitlab" ? "merge" : "squash",
  );
  const [confirming, setConfirming] = useState(false);
  const { call, error } = useCall(pr);
  const blockers = mergeBlockers(pr);
  const rows = requirements(pr, memberName);
  const autopilot = useAutopilotGoverns(pr);
  const merging = writes.some(
    (w) => w.kind === "merge" && w.status !== "failed",
  );
  const status = writes.map((w) => <WriteStatus key={w.id} write={w} />);
  if (pr.state === "merged")
    return (
      <div className="space-y-3">
        {status}
        <MergedNotice>
          <p>
            Merged into{" "}
            <code className="font-mono text-xs">{pr.baseBranch}</code>
            {pr.mergedAt && ` ${relativeTime(pr.mergedAt)}`}
            {pr.mergeRequestedById
              ? // Autopilot names its policy's administrator itself.
                pr.mergedVia?.startsWith("Autopilot")
                ? ` by ${pr.mergedVia}.`
                : ` from Lictory by ${pr.mergedVia ? `${pr.mergedVia} via ` : ""}${memberName(pr.mergeRequestedById)}.`
              : pr.mergedByLogin
                ? ` by ${pr.mergedByLogin} on the code host.`
                : "."}
          </p>
          {/* What the merge rested on: the head's checks and reviews. */}
          <ul
            aria-label="Merged on"
            className="mt-2 space-y-1 text-xs text-muted-foreground"
          >
            {requirements(pr, memberName)
              .filter((r) => r.key !== "conflicts")
              .map((r) => (
                <li key={r.key} className="flex items-start gap-2">
                  <CheckIcon state={r.state} className="mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-foreground">{r.text}</p>
                    {r.detail && <div>{r.detail}</div>}
                  </div>
                </li>
              ))}
          </ul>
        </MergedNotice>
      </div>
    );
  if (pr.state === "closed")
    return (
      <div className="space-y-3">
        {status}
        <p className="rounded-xl bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-(--shadow-border)">
          Closed without merging
          {pr.closedAt && ` ${relativeTime(pr.closedAt)}`}.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {status}
      <MergeBox
        target={pr.baseBranch}
        requirements={rows}
        blocked={blockers.length > 0}
        readySummary={readySummary(rows, pr.baseBranch)}
        before={autopilot && <AutopilotWaits pr={pr} />}
        note={
          !canWork
            ? "Merging here needs “Change properties” in a project this repository serves."
            : confirming
              ? `Lictory merges head ${shortSha(pr.headSha)} as you see it here; if new commits arrive first, the merge is refused. The code host’s branch protection still applies.`
              : blockers.length > 0
                ? "Merge once every requirement above is met."
                : "The code host’s branch protection still applies."
        }
        action={
          canWork && (
            <>
              <DropdownSelect
                aria-label="Merge method"
                value={method}
                onValueChange={(v) => setMethod(v as typeof method)}
                size="sm"
                disabled={!!blockers.length || merging}
              >
                <DropdownSelectOption value="squash">
                  Squash and merge
                </DropdownSelectOption>
                <DropdownSelectOption value="merge">
                  Merge commit
                </DropdownSelectOption>
                {pr.provider !== "gitlab" && (
                  <DropdownSelectOption value="rebase">
                    Rebase and merge
                  </DropdownSelectOption>
                )}
              </DropdownSelect>
              {confirming ? (
                <>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      await call("mergeCodePullRequest", {
                        expectedHeadSha: pr.headSha,
                        method,
                      });
                      setConfirming(false);
                    }}
                  >
                    <GitMerge className="size-3.5" aria-hidden />
                    Merge {shortSha(pr.headSha)}
                  </Button>
                </>
              ) : (
                <Button
                  disabled={!!blockers.length || merging}
                  onClick={() => setConfirming(true)}
                >
                  {merging ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <GitMerge className="size-3.5" aria-hidden />
                  )}
                  Merge
                </Button>
              )}
            </>
          )
        }
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// Whether Autopilot merges this pull request by itself: an agent's pull
// request delivering an item of a project on Autopilot.
function useAutopilotGoverns(pr: CodePullRequestEntity) {
  const { view } = useWorkspace();
  if (!(pr.agentSessionId ?? pr.agentId)) return null;
  const projectIds = new Set(pr.links.map((l) => l.projectId));
  return (
    byType(Object.values(view.entities), "autonomyPolicy").find(
      (p) => projectIds.has(p.projectId) && p.level === "autopilot",
    ) ?? null
  );
}

// What Autopilot waits for before it merges, in the merge box: a person
// sees why nothing has happened yet, and that a missing check is waited
// for, never taken as a pass.
function AutopilotWaits({ pr }: { pr: CodePullRequestEntity }) {
  const policy = useAutopilotGoverns(pr);
  const { agentById } = useFactory();
  if (!policy) return null;
  const reviewer = policy.reviewerAgentId
    ? (agentById.get(policy.reviewerAgentId)?.name ?? "the reviewer agent")
    : null;
  const conditions = [
    `the code host reports passing checks on ${shortSha(pr.headSha)}`,
    policy.autopilotRequires.includes("code_review_approved") && reviewer
      ? `${reviewer} approves it`
      : null,
    policy.autopilotRequires.includes("definition_of_done")
      ? "every other Definition of Done check passes"
      : null,
  ].filter((c): c is string => Boolean(c));
  const waiting =
    pr.checks.state === "none"
      ? "Waiting: the code host has reported no checks for this commit yet."
      : pr.checks.state === "pending"
        ? "Waiting: checks are still running."
        : pr.checks.state === "failure"
          ? "Checks are failing, so Autopilot will not merge this commit."
          : null;
  return (
    <div className="flex items-start gap-2 text-xs" data-autopilot-waits>
      <Bot aria-hidden className="mt-px size-3.5 shrink-0" />
      <p>
        <span className="font-medium">Autopilot</span> merges this when{" "}
        {conditions.length > 1
          ? `${conditions.slice(0, -1).join(", ")} and ${conditions.at(-1)}`
          : conditions[0]}
        .{waiting && <span className="text-muted-foreground"> {waiting}</span>}
      </p>
    </div>
  );
}

// A comment for the code host, written in the shared editor and signed
// with the person's name there; closing and reopening sit beside it.
function Discussion({ pr }: { pr: CodePullRequestEntity }) {
  const canWork = useCanWork(pr);
  const [comment, setComment] = useState("");
  const { call, error } = useCall(pr);
  const editor = useRef<MarkdownEditorHandle>(null);
  if (!canWork) return null;
  const noun = changeNoun(pr.provider);
  const send = async () => {
    if (!comment.trim()) return;
    if (await call("commentOnCodePullRequest", { body: comment.trim() }))
      setComment("");
  };
  return (
    <form
      aria-label="Comment"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {/* The shared composer's frame: the rich editor with its toolbar,
          the action at its end (as in channels and sessions). */}
      <div className="flex items-end gap-1 rounded-xl border border-input bg-card pr-1.5 pb-1.5 shadow-xs transition-shadow focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/10">
        <div className="min-w-0 flex-1">
          <MarkdownEditor
            ref={editor}
            value={comment}
            onValueChange={setComment}
            onSubmit={() => void send()}
            references={false}
            compact
            minHeight="3rem"
            maxHeight="20rem"
            placeholder={`Comment on ${providerLabels[pr.provider]}`}
            aria-label="Comment"
            aria-describedby="code-comment-hint"
            containerClassName="rounded-xl border-0 bg-transparent ring-0 focus-within:border-transparent focus-within:ring-0"
          />
        </div>
        <Button type="submit" size="sm" disabled={!comment.trim()}>
          Comment
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <p
          id="code-comment-hint"
          className="mr-auto px-1 text-xs text-muted-foreground"
        >
          Posted on {providerLabels[pr.provider]}, signed with your name.
        </p>
        {codePullRequest.allows(pr.state, "close") && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => call("setCodePullRequestState", { state: "closed" })}
          >
            Close {noun}
          </Button>
        )}
        {codePullRequest.allows(pr.state, "reopen") &&
          pr.provider !== "bitbucket" && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => call("setCodePullRequestState", { state: "open" })}
            >
              Reopen
            </Button>
          )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function FilesChanged({
  pr,
  noun,
}: {
  pr: CodePullRequestEntity;
  noun: string;
}) {
  const { organization } = useWorkspace();
  const [files, setFiles] = useState<Files | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setFiles(
        await callCapability<Files>("getCodePullRequestFiles", {
          organizationId: organization.id,
          pullRequestId: pr.id,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  // Opening the view is asking: the files are read from the host then.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stale = files && files.headSha !== pr.headSha;
  return (
    <section aria-label="Files changed">
      <div className="mb-3 flex min-h-8 items-center gap-2">
        <p className="text-[13px] text-muted-foreground">
          {files
            ? `${files.files.length} file${files.files.length === 1 ? "" : "s"} · +${files.files.reduce((n, f) => n + f.additions, 0)} −${files.files.reduce((n, f) => n + f.deletions, 0)}`
            : busy
              ? "Reading the files from the code host…"
              : ""}
        </p>
        {((!files && !busy) || stale) && (
          <Button size="sm" variant="secondary" onClick={load} disabled={busy}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileDiff className="size-3.5" />
            )}
            {stale ? "Load the new head" : "Try again"}
          </Button>
        )}
      </div>
      {!files && !busy && !error && (
        <p className="text-[13px] text-muted-foreground">
          Read from the code host when you ask; Lictory does not keep a copy of
          the {noun}’s diff.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {files && (
        <ul className="space-y-2">
          {files.files.map((f) => (
            <li
              key={f.path}
              className="overflow-hidden rounded-xl bg-card shadow-(--shadow-border)"
            >
              <Collapsible defaultOpen={files.files.length <= 10}>
                <CollapsibleTrigger className="group flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left text-[13px] focus-ring-inset outline-none hover:bg-muted/60">
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {f.previousPath ? `${f.previousPath} → ${f.path}` : f.path}
                  </span>
                  <span className="font-mono text-xs text-success">
                    +{f.additions}
                  </span>
                  <span className="font-mono text-xs text-destructive">
                    −{f.deletions}
                  </span>
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  {f.patch ? (
                    // Old and new line numbers in a gutter, then the line.
                    <pre
                      role="group"
                      aria-label={`Diff of ${f.path}`}
                      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs a tab stop to scroll with arrow keys
                      tabIndex={0}
                      className="grid grid-cols-[auto_auto_1fr] overflow-x-auto border-t font-mono text-xs leading-5 focus-ring-inset outline-none"
                    >
                      {numberPatch(f.patch).map((line, i) => {
                        const tone = cn(
                          line.kind === "add" && "bg-success/10",
                          line.kind === "delete" && "bg-destructive/10",
                          line.kind === "hunk" &&
                            "bg-muted text-muted-foreground",
                          line.kind === "note" && "text-muted-foreground",
                        );
                        return (
                          <Fragment key={i}>
                            <span
                              aria-hidden
                              className={cn(
                                "min-w-10 pr-2 pl-3 text-right text-muted-foreground tabular-nums select-none",
                                tone,
                              )}
                            >
                              {line.old ?? ""}
                            </span>
                            <span
                              aria-hidden
                              className={cn(
                                "min-w-10 border-r pr-2 text-right text-muted-foreground tabular-nums select-none",
                                tone,
                              )}
                            >
                              {line.new ?? ""}
                            </span>
                            <span
                              className={cn("pr-3 pl-2 whitespace-pre", tone)}
                            >
                              {line.text || " "}
                            </span>
                          </Fragment>
                        );
                      })}
                    </pre>
                  ) : (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      {f.truncated
                        ? "Too large to show here. Open it on the code host."
                        : "No text diff (binary, or the host left it out)."}
                    </p>
                  )}
                </CollapsiblePanel>
              </Collapsible>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
