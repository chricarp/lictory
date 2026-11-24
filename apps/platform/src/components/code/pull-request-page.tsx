import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  FileDiff,
  GitMerge,
  Loader2,
} from "lucide-react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { callCapability } from "@lictory/core/capabilities/client";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";
import { mergeBlockers } from "@lictory/core/code/merge-rules";
import type { CodePullRequestFile } from "@lictory/core/code/provider";
import { codePullRequest } from "@lictory/core/contracts/state-machines";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { identifier, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Badge, EmptyState, SectionLabel } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { Markdown } from "@lictory/platform/components/items/markdown";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodePullRequest,
  useCodeWrites,
} from "@lictory/platform/components/code/store";
import {
  ChecksBadge,
  ChecksIcon,
  PullRequestIcon,
  ReviewBadge,
  changeNoun,
  codePaths,
  message,
  shortSha,
  stateWords,
} from "@lictory/platform/components/code/parts";
import { WriteStatus } from "@lictory/platform/components/code/write-status";

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
    return complete ? (
      <EmptyState title="This pull request is unavailable">
        It may belong to a code host that was disconnected.{" "}
        <Link className="underline" href={codePaths.index(organization.slug)}>
          Back to Code
        </Link>
      </EmptyState>
    ) : (
      <LoadingState label="Loading the pull request" />
    );
  return <PullRequestView pr={pullRequest} />;
}

function PullRequestView({ pr }: { pr: CodePullRequestEntity }) {
  const { organization, memberName } = useWorkspace();
  const noun = changeNoun(pr.provider);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-[13px]">
        <Link
          href={codePaths.index(organization.slug)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Code
        </Link>
        <span className="truncate text-muted-foreground">
          {pr.repositoryFullName}#{pr.number}
        </span>
        <a
          href={pr.webUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Open on the host <ArrowUpRight className="size-3" />
        </a>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="min-w-0 space-y-6">
            <div>
              <h1 className="flex items-start gap-2 text-xl font-semibold tracking-tight">
                <PullRequestIcon
                  state={pr.state}
                  draft={pr.draft}
                  className="mt-1.5"
                />
                <span>{pr.title}</span>
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                <Badge
                  tone={
                    pr.state === "open"
                      ? "good"
                      : pr.state === "merged"
                        ? "info"
                        : "neutral"
                  }
                >
                  {pr.draft && pr.state === "open"
                    ? "Draft"
                    : stateWords[pr.state]}
                </Badge>
                <span>
                  {pr.openedVia
                    ? `${pr.openedVia} via ${memberName(pr.openedById)}`
                    : pr.openedById
                      ? memberName(pr.openedById)
                      : (pr.authorLogin ?? "unknown")}{" "}
                  wants to merge
                </span>
                <code className="rounded bg-muted px-1.5 font-mono text-xs">
                  {pr.headBranch}
                </code>
                into
                <code className="rounded bg-muted px-1.5 font-mono text-xs">
                  {pr.baseBranch}
                </code>
                <span>· head {shortSha(pr.headSha)}</span>
                <span>· updated {relativeTime(pr.hostUpdatedAt)}</span>
              </p>
            </div>
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
            <Actions pr={pr} />
            <FilesChanged pr={pr} noun={noun} />
          </main>
          <aside className="space-y-6">
            <Checks pr={pr} />
            <Reviews pr={pr} />
            <LinkedItems pr={pr} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Checks({ pr }: { pr: CodePullRequestEntity }) {
  return (
    <section>
      <SectionLabel className="mb-2">Checks</SectionLabel>
      <ChecksBadge checks={pr.checks} />
      {pr.checks.runs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pr.checks.runs.map((run) => (
            <li key={run.name} className="flex items-center gap-2 text-[13px]">
              <ChecksIcon
                state={run.state === "neutral" ? "success" : run.state}
              />
              {run.url ? (
                <a
                  href={run.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate underline-offset-2 hover:underline"
                >
                  {run.name}
                </a>
              ) : (
                <span className="truncate">{run.name}</span>
              )}
              {run.state === "neutral" && (
                <span className="text-xs text-muted-foreground">skipped</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reviews({ pr }: { pr: CodePullRequestEntity }) {
  return (
    <section>
      <SectionLabel className="mb-2">Reviews</SectionLabel>
      <ReviewBadge decision={pr.reviewDecision} />
      <dl className="mt-2 space-y-1 text-[13px]">
        {pr.approvedBy.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Approved by</dt>
            <dd>{pr.approvedBy.join(", ")}</dd>
          </div>
        )}
        {pr.requestedReviewers.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Asked to review</dt>
            <dd>{pr.requestedReviewers.join(", ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function LinkedItems({ pr }: { pr: CodePullRequestEntity }) {
  const { organization, items, projects } = useWorkspace();
  return (
    <section>
      <SectionLabel className="mb-2">Work items</SectionLabel>
      {pr.links.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Not linked. Name a work item’s key (PAY-142) in the title, description
          or branch, or link it from the item.
        </p>
      ) : (
        <ul className="space-y-1">
          {pr.links.map((link) => {
            const item = items.find((i) => i.id === link.workItemId);
            const project = projects.find((p) => p.id === link.projectId);
            if (!item || !project) return null;
            return (
              <li key={link.workItemId}>
                <Link
                  href={paths.item(organization.slug, project.key, item.id)}
                  className="flex items-baseline gap-2 rounded-md px-1 py-0.5 text-[13px] hover:bg-muted"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {identifier(project, item.number)}
                  </span>
                  <span className="truncate">{item.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Actions({ pr }: { pr: CodePullRequestEntity }) {
  const { organization, capabilitiesIn } = useWorkspace();
  const { repositories } = useCodeHosts();
  const writes = useCodeWrites().filter((w) => w.pullRequestId === pr.id);
  const repository = repositories.find((r) => r.id === pr.repositoryId);
  const canWork = (repository?.projectIds ?? []).some(
    (id) => capabilitiesIn(id).changeProperties,
  );
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">(
    pr.provider === "gitlab" ? "merge" : "squash",
  );
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const blockers = mergeBlockers(pr);
  const merging = writes.some(
    (w) => w.kind === "merge" && w.status !== "failed",
  );
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
  return (
    <section aria-label="Actions" className="space-y-3">
      {writes.map((w) => (
        <WriteStatus key={w.id} write={w} />
      ))}
      {pr.state === "open" && (
        <div className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <GitMerge aria-hidden className="size-4 text-muted-foreground" />
            <p className="flex-1 text-[13px] font-medium">
              {blockers.length ? "Not ready to merge" : "Ready to merge"}
            </p>
            {canWork && (
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        await call("mergeCodePullRequest", {
                          expectedHeadSha: pr.headSha,
                          method,
                        });
                        setConfirming(false);
                      }}
                    >
                      Merge {shortSha(pr.headSha)}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={!!blockers.length || merging}
                    onClick={() => setConfirming(true)}
                  >
                    {merging && <Loader2 className="size-3.5 animate-spin" />}
                    Merge
                  </Button>
                )}
              </>
            )}
          </div>
          {blockers.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-9 text-xs text-muted-foreground">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {confirming && (
            <p className="mt-2 pl-6 text-xs text-muted-foreground">
              Lictory merges head {shortSha(pr.headSha)} as you see it here; if
              new commits arrive first, the merge is refused. The code host’s
              branch protection still applies.
            </p>
          )}
          {!canWork && (
            <p className="mt-2 pl-6 text-xs text-muted-foreground">
              Merging here needs “Change properties” in a project this
              repository serves.
            </p>
          )}
        </div>
      )}
      {canWork && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call("commentOnCodePullRequest", { body: comment }))
              setComment("");
          }}
        >
          <label className="grid gap-1 text-[13px]">
            <span className="text-xs text-muted-foreground">
              Comment on the host (signed with your name)
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="rounded-lg border bg-background px-3 py-2 text-[13px]"
              placeholder="Leave a comment"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              type="submit"
              disabled={!comment.trim()}
            >
              Comment
            </Button>
            {codePullRequest.allows(pr.state, "close") && (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() =>
                  call("setCodePullRequestState", { state: "closed" })
                }
              >
                Close {changeNoun(pr.provider)}
              </Button>
            )}
            {codePullRequest.allows(pr.state, "reopen") &&
              pr.provider !== "bitbucket" && (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    call("setCodePullRequestState", { state: "open" })
                  }
                >
                  Reopen
                </Button>
              )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
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
  const stale = files && files.headSha !== pr.headSha;
  return (
    <section aria-label="Files changed">
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Files changed</SectionLabel>
        {(!files || stale) && (
          <Button size="sm" variant="secondary" onClick={load} disabled={busy}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileDiff className="size-3.5" />
            )}
            {stale ? "Load the new head" : "Show files changed"}
          </Button>
        )}
      </div>
      {!files && !busy && (
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
            <li key={f.path} className="rounded-lg border">
              <Collapsible defaultOpen={files.files.length <= 10}>
                <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted/60">
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
