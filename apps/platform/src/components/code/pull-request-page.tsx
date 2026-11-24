import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
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
import { relativeTime } from "@lictory/core/lib/work-items";
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
import { useFactory } from "@lictory/platform/components/factory/store";
import {
  useCodeHosts,
  useCodePullRequest,
  useCodeWrites,
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
  const { organization } = useWorkspace();
  const { agentById } = useFactory();
  const noun = changeNoun(pr.provider);
  const [tab, setTab] = useState<"conversation" | "files">("conversation");
  const agent = pr.agentId ? agentById.get(pr.agentId) : undefined;
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
                ) : pr.openedById ? (
                  <Actor userId={pr.openedById} size={20} />
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
// in words. `mergeBlockers` is the rule; these rows explain it.
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
          detail: runs.length > 0 && <CheckRuns runs={runs} />,
        }
      : pr.checks.state === "failure"
        ? {
            key: "checks",
            state: "failure",
            text: `Checks are failing (${failing.length} of ${runs.length}).`,
            detail: <CheckRuns runs={runs} />,
          }
        : pr.checks.state === "pending"
          ? {
              key: "checks",
              state: "running",
              text: `Checks are still running (${running.length} of ${runs.length}).`,
              detail: <CheckRuns runs={runs} />,
            }
          : {
              key: "checks",
              state: "neutral",
              text: "The code host reports no checks.",
            },
  );
  const lictoryReviewers = pr.reviews
    .filter((r) => r.current && r.decision === "approve")
    .map((r) =>
      r.agentName
        ? `${r.agentName} via ${memberName(r.reviewerId)}`
        : memberName(r.reviewerId),
    );
  const approvers = [...pr.approvedBy, ...lictoryReviewers];
  rows.push(
    pr.reviewDecision === "approved"
      ? {
          key: "reviews",
          state: "success",
          text: "Approved.",
          detail: approvers.length > 0 && `By ${approvers.join(", ")}.`,
        }
      : pr.reviewDecision === "changes_requested"
        ? {
            key: "reviews",
            state: "failure",
            text: "A reviewer requested changes.",
          }
        : pr.reviewDecision === "review_required"
          ? {
              key: "reviews",
              state: "pending",
              text: "A review is required.",
              detail:
                pr.requestedReviewers.length > 0 &&
                `Asked: ${pr.requestedReviewers.join(", ")}.`,
            }
          : {
              key: "reviews",
              state: "neutral",
              text: "No reviews yet.",
              detail:
                pr.requestedReviewers.length > 0 &&
                `Asked: ${pr.requestedReviewers.join(", ")}.`,
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

function CheckRuns({
  runs,
}: {
  runs: CodePullRequestEntity["checks"]["runs"];
}) {
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
      {runs.map((run) => (
        <li key={run.name} className="inline-flex items-center gap-1">
          <ChecksIcon state={run.state === "neutral" ? "none" : run.state} />
          {run.url ? (
            <a
              href={run.url}
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
        requirements={requirements(pr, memberName)}
        blocked={blockers.length > 0}
        readySummary={`Checks, reviews and conflicts allow merging into ${pr.baseBranch}.`}
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
      <p id="code-comment-hint" className="text-xs text-muted-foreground">
        Comment on {providerLabels[pr.provider]}, signed with your name.
      </p>
      <MarkdownEditor
        ref={editor}
        value={comment}
        onValueChange={setComment}
        onSubmit={() => void send()}
        references={false}
        compact
        minHeight="4.5rem"
        maxHeight="20rem"
        placeholder="Leave a comment"
        aria-label="Comment"
        aria-describedby="code-comment-hint"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" variant="secondary" disabled={!comment.trim()}>
          Comment
        </Button>
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
                    <pre className="overflow-x-auto border-t text-xs leading-5">
                      {f.patch.split("\n").map((line, i) => (
                        <div
                          key={i}
                          className={cn(
                            "px-3 font-mono whitespace-pre",
                            line.startsWith("+") && "bg-success/10",
                            line.startsWith("-") && "bg-destructive/10",
                            line.startsWith("@@") &&
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {line || " "}
                        </div>
                      ))}
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
