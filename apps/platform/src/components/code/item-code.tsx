import { useState } from "react";
import { Check, Copy, GitBranch, Link2, Loader2, Plus, X } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  CodeLinkEntity,
  CodeLinkTarget,
} from "@lictory/core/code/entities";
import { suggestBranchName } from "@lictory/core/code/keys";
import { identifier, type Project } from "@lictory/core/lib/work-items";
import type { WorkItem } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Badge, SectionLabel } from "@lictory/ui/primitives";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useWorkItemCode,
} from "@lictory/platform/components/code/store";
import {
  ChecksIcon,
  PullRequestIcon,
  ReviewBadge,
  TargetIcon,
  codePaths,
  message,
  shortSha,
} from "@lictory/platform/components/code/parts";
import { WriteStatus } from "@lictory/platform/components/code/write-status";

// A work item's Code panel: its pull requests (with checks and review
// state), branches, issues and commits, what Lictory is sending to the host
// for it, and the actions that start code for it. Live through Zero.

const order: Record<CodeLinkTarget, number> = {
  pull_request: 0,
  branch: 1,
  issue: 2,
  commit: 3,
};

export function ItemCode({
  item,
  project,
  canChange,
}: {
  item: WorkItem;
  project: Project | undefined;
  canChange: boolean;
}) {
  const { organization } = useWorkspace();
  const { links, writes } = useWorkItemCode(item.id);
  const { repositories, connections } = useCodeHosts();
  const serving = repositories.filter((r) =>
    r.projectIds.includes(item.projectId),
  );
  const [repositoryId, setRepositoryId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  if (!connections.length && !links.length) return null;
  const key = identifier(project, item.number);
  const branchName = suggestBranchName(key, item.title);
  const repository = serving.find((r) => r.id === repositoryId) ?? serving[0];
  const sorted = [...links].sort(
    (a, b) =>
      order[a.target] - order[b.target] ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const openPrBranches = new Set(
    links.flatMap((l) =>
      l.summary.target === "pull_request" && l.summary.state === "open"
        ? [`${l.repositoryId}:${l.summary.headBranch}`]
        : [],
    ),
  );
  const pending = writes.filter((w) => w.status !== "failed");
  const failed = writes.filter((w) => w.status === "failed");
  const call = async (name: string, input: Record<string, unknown>) => {
    setError(undefined);
    try {
      await callCapability(name, { organizationId: organization.id, ...input });
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <section aria-labelledby={`code-${item.id}`} data-item-code>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>
          <span id={`code-${item.id}`}>Code</span>
        </SectionLabel>
        {canChange && serving.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="-my-1 ml-auto"
            aria-label="Link code to this item"
            onClick={() => setLinking((v) => !v)}
          >
            <Link2 className="size-3.5" />
          </Button>
        )}
      </div>
      {sorted.length > 0 && (
        <ul className="space-y-1">
          {sorted.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              canChange={canChange}
              hasOpenPullRequest={
                link.summary.target === "branch" &&
                openPrBranches.has(`${link.repositoryId}:${link.summary.name}`)
              }
              onUnlink={() =>
                call("unlinkCodeFromWorkItem", { linkId: link.id })
              }
              onOpenPullRequest={(head) =>
                call("openCodePullRequest", {
                  workItemId: item.id,
                  repositoryId: link.repositoryId,
                  head,
                  mutationId: crypto.randomUUID(),
                })
              }
            />
          ))}
        </ul>
      )}
      {[...pending, ...failed].map((w) => (
        <WriteStatus key={w.id} write={w} className="mt-1.5" />
      ))}
      {sorted.length === 0 && pending.length === 0 && (
        <p className="text-[13px] leading-5 text-muted-foreground">
          {serving.length
            ? `Branches, pull requests and commits that mention ${key} appear here.`
            : `${project?.name ?? "This project"} has no repository yet. A project administrator links one in organization settings → Code hosts.`}
        </p>
      )}
      {linking && repository && (
        <LinkForm
          workItemId={item.id}
          repositories={serving}
          onDone={() => setLinking(false)}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Copy branch name ${branchName}`}
          onClick={async () => {
            await navigator.clipboard?.writeText(branchName);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy branch name"}
        </Button>
        {canChange && repository && (
          <>
            {serving.length > 1 && (
              <DropdownSelect
                aria-label="Repository"
                value={repository.id}
                onValueChange={setRepositoryId}
                size="sm"
              >
                {serving.map((r) => (
                  <DropdownSelectOption key={r.id} value={r.id}>
                    {r.fullName}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                call("createCodeBranch", {
                  workItemId: item.id,
                  repositoryId: repository.id,
                  mutationId: crypto.randomUUID(),
                })
              }
            >
              <GitBranch className="size-3.5" /> Create branch
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function LinkRow({
  link,
  canChange,
  hasOpenPullRequest,
  onUnlink,
  onOpenPullRequest,
}: {
  link: CodeLinkEntity;
  canChange: boolean;
  hasOpenPullRequest: boolean;
  onUnlink: () => void;
  onOpenPullRequest: (head: string) => void;
}) {
  const { organization } = useWorkspace();
  const s = link.summary;
  const label =
    s.target === "pull_request"
      ? `#${s.number} ${s.title}`
      : s.target === "issue"
        ? `#${s.number} ${s.title}`
        : s.target === "branch"
          ? s.name
          : `${shortSha(s.sha)} ${s.message}`;
  return (
    <li className="group flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-muted/60">
      <span className="mt-0.5">
        {s.target === "pull_request" ? (
          <PullRequestIcon state={s.state} draft={s.draft} />
        ) : (
          <TargetIcon target={link.target} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {s.target === "pull_request" ? (
          <Link
            href={codePaths.pullRequest(organization.slug, link.targetId)}
            className="line-clamp-2 font-medium underline-offset-2 hover:underline"
          >
            {label}
          </Link>
        ) : (
          <a
            href={s.webUrl}
            target="_blank"
            rel="noreferrer"
            className={`line-clamp-2 underline-offset-2 hover:underline ${
              s.target === "branch" ? "font-mono text-xs" : ""
            }`}
          >
            {label}
          </a>
        )}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{link.repositoryFullName}</span>
          {s.target === "pull_request" && (
            <>
              <ChecksIcon state={s.checks} />
              {s.state === "open" && (
                <ReviewBadge decision={s.reviewDecision} />
              )}
            </>
          )}
          {s.target === "branch" && s.deleted && <Badge>Deleted</Badge>}
          {s.target === "issue" && s.state === "closed" && (
            <Badge>Closed</Badge>
          )}
          {link.source === "agent_session" && <Badge tone="info">Agent</Badge>}
        </span>
        {s.target === "branch" &&
          !s.deleted &&
          !hasOpenPullRequest &&
          canChange && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 -ml-2"
              onClick={() => onOpenPullRequest(s.name)}
            >
              <Plus className="size-3.5" /> Open pull request
            </Button>
          )}
      </span>
      {canChange && (
        <button
          type="button"
          aria-label={`Unlink ${label}`}
          onClick={onUnlink}
          className="rounded p-0.5 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

function LinkForm({
  workItemId,
  repositories,
  onDone,
}: {
  workItemId: string;
  repositories: { id: string; fullName: string }[];
  onDone: () => void;
}) {
  const { organization } = useWorkspace();
  const [target, setTarget] = useState<CodeLinkTarget>("pull_request");
  const [repositoryId, setRepositoryId] = useState(repositories[0]!.id);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="mt-2 grid gap-2 rounded-lg border bg-muted/40 p-2.5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await callCapability("linkCodeToWorkItem", {
            organizationId: organization.id,
            workItemId,
            repositoryId,
            target,
            ref,
          });
          onDone();
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        <DropdownSelect
          aria-label="What to link"
          value={target}
          onValueChange={(v) => setTarget(v as CodeLinkTarget)}
          size="sm"
        >
          <DropdownSelectOption value="pull_request">
            Pull request
          </DropdownSelectOption>
          <DropdownSelectOption value="branch">Branch</DropdownSelectOption>
          <DropdownSelectOption value="issue">Issue</DropdownSelectOption>
          <DropdownSelectOption value="commit">Commit</DropdownSelectOption>
        </DropdownSelect>
        {repositories.length > 1 && (
          <DropdownSelect
            aria-label="Repository"
            value={repositoryId}
            onValueChange={setRepositoryId}
            size="sm"
          >
            {repositories.map((r) => (
              <DropdownSelectOption key={r.id} value={r.id}>
                {r.fullName}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
        )}
      </div>
      <Input
        aria-label={
          target === "branch"
            ? "Branch name"
            : target === "commit"
              ? "Commit SHA"
              : "Number"
        }
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder={
          target === "branch"
            ? "feature/name"
            : target === "commit"
              ? "a1b2c3d"
              : "#12"
        }
        className="h-8 text-[13px]"
        required
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" type="submit" disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Link
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
