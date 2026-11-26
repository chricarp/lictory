import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  FolderGit2,
  GitPullRequest,
  Settings2,
} from "lucide-react";
import { Tabs, TabsPanel } from "@ui-sdk/react/tabs";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  CodeIssueEntity,
  CodeLinkRef,
  CodePullRequestEntity,
} from "@lictory/core/code/entities";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { identifier, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Badge, EmptyState } from "@lictory/ui/primitives";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { LoadingState } from "@lictory/ui/spinner";
import { toast } from "@lictory/ui/toast";
import {
  Link,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodeList,
  useCodeWrites,
} from "@lictory/platform/components/code/store";
import {
  ChecksIcon,
  PullRequestIcon,
  ReviewBadge,
  TargetIcon,
  codePaths,
  message,
  providerLabels,
} from "@lictory/platform/components/code/parts";
import { WriteStatus } from "@lictory/platform/components/code/write-status";
import {
  PageHeader,
  PageTabs,
} from "@lictory/platform/components/shell/page-header";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { Actor, AgentActor } from "@lictory/platform/components/identity/actor";
import { useFactory } from "@lictory/platform/components/factory/store";

// /$org/code: pull requests, issues and repositories from the connected
// code hosts, live. The hosts own all of it; Lictory adds the links to
// work items and the people behind agent-authored changes.

type Tab = "pull-requests" | "issues" | "repositories";

// Phones (under Tailwind's `sm`): the header keeps the title and the tabs
// take a row of their own, as on the Factory. One tab list, placed by width.
const phoneQuery = "(max-width: 639px)";
function usePhone() {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(phoneQuery);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}
type Who = "all" | "mine" | "review" | "agents";

export function CodePage() {
  const { organization, isAdmin } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab =
    searchParams.get("tab") === "issues"
      ? "issues"
      : searchParams.get("tab") === "repositories"
        ? "repositories"
        : "pull-requests";
  const { connections, complete } = useCodeHosts();
  const phone = usePhone();
  const header = (tabs?: React.ReactNode) => (
    <PageHeader
      title="Code"
      icon={<GitPullRequest />}
      tabs={tabs}
      actions={
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={paths.settings(organization.slug, "code")} />}
          aria-label="Code hosts"
        >
          <Settings2 className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Code hosts</span>
        </Button>
      }
    />
  );
  if (complete && connections.length === 0)
    return (
      <div className="flex h-full flex-col">
        {/* The page keeps its heading before a host is connected, like every
            module page. */}
        {header()}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            illustration="planning"
            title="Connect a code host"
            action={
              isAdmin ? (
                <Button
                  render={
                    <Link href={paths.settings(organization.slug, "code")} />
                  }
                >
                  Connect GitHub, GitLab or Bitbucket
                </Button>
              ) : undefined
            }
          >
            Lictory shows your pull requests, checks and issues next to the work
            they deliver once a code host is connected.
            {!isAdmin && " Ask an organization administrator to connect one."}
          </EmptyState>
        </div>
      </div>
    );
  const tabs = (
    <PageTabs
      label="Code view"
      tabs={[
        { value: "pull-requests", label: "Pull requests" },
        { value: "issues", label: "Issues" },
        { value: "repositories", label: "Repositories" },
      ]}
    />
  );
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        if (next === null || next === tab) return;
        router.replace(codePaths.index(organization.slug, next));
      }}
      className="flex h-full flex-col"
    >
      {header(phone ? undefined : tabs)}
      {phone && (
        <div className="flex h-10 shrink-0 items-center border-b px-2">
          {tabs}
        </div>
      )}
      <TabsPanel value="pull-requests" className="min-h-0 flex-1">
        {tab === "pull-requests" && <PullRequests />}
      </TabsPanel>
      <TabsPanel value="issues" className="min-h-0 flex-1">
        {tab === "issues" && <Issues />}
      </TabsPanel>
      <TabsPanel value="repositories" className="min-h-0 flex-1">
        {tab === "repositories" && <Repositories />}
      </TabsPanel>
    </Tabs>
  );
}

function useItemKeys() {
  const { items, projects } = useWorkspace();
  return useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    return (link: CodeLinkRef) => {
      const item = byId.get(link.workItemId);
      return item
        ? {
            key: identifier(projectById.get(item.projectId), item.number),
            title: item.title,
            project: projectById.get(item.projectId),
            id: item.id,
          }
        : undefined;
    };
  }, [items, projects]);
}

function ItemChips({ links }: { links: CodeLinkRef[] }) {
  const { organization } = useWorkspace();
  const keyOf = useItemKeys();
  const shown = links.flatMap((l) => {
    const k = keyOf(l);
    return k?.project ? [k] : [];
  });
  if (!shown.length) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {shown.slice(0, 3).map((k) => (
        <Link
          key={k.id}
          href={paths.item(organization.slug, k.project!.key, k.id)}
          title={k.title}
          className="relative z-10 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground focus-ring outline-none hover:text-foreground"
        >
          {k.key}
        </Link>
      ))}
      {shown.length > 3 && (
        <span className="text-[11px] text-muted-foreground">
          +{shown.length - 3}
        </span>
      )}
    </span>
  );
}

// The lists sit in the same centred column as every other index (Home,
// Factory), so a row's state is not a screen's width from its title.
const column = "mx-auto w-full max-w-5xl";

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b">
      <div
        className={cn(column, "flex flex-wrap items-center gap-2 px-4 py-2")}
      >
        {children}
      </div>
    </div>
  );
}

function PullRequests() {
  const { userId, projects } = useWorkspace();
  const { repositories, myLogins, identities } = useCodeHosts();
  const owners = useMemo(
    () => new Map(identities.map((i) => [i.login.toLowerCase(), i.userId])),
    [identities],
  );
  const [state, setState] = useState<"open" | "merged" | "closed">("open");
  const [who, setWho] = useState<Who>("all");
  const [repositoryId, setRepositoryId] = useState("");
  const [projectId, setProjectId] = useState("");
  const { rows, complete } = useCodeList("codePullRequest", state);
  const writes = useCodeWrites();
  const failed = writes.filter(
    (w) => w.status === "failed" && w.requestedById === userId,
  );
  const shown = rows
    .filter(
      (p) =>
        (!repositoryId || p.repositoryId === repositoryId) &&
        (!projectId || p.links.some((l) => l.projectId === projectId)) &&
        (who === "all" ||
          (who === "mine" &&
            (p.openedById === userId ||
              (!!p.authorLogin &&
                myLogins.has(p.authorLogin.toLowerCase())))) ||
          (who === "review" &&
            p.requestedReviewers.some((r) => myLogins.has(r.toLowerCase()))) ||
          (who === "agents" && p.agentAuthored)),
    )
    .sort((a, b) => b.hostUpdatedAt.localeCompare(a.hostUpdatedAt));
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <Segmented aria-label="State" value={state} onValueChange={setState}>
          <SegmentedItem value="open">Open</SegmentedItem>
          <SegmentedItem value="merged">Merged</SegmentedItem>
          <SegmentedItem value="closed">Closed</SegmentedItem>
        </Segmented>
        <Segmented aria-label="Whose" value={who} onValueChange={setWho}>
          <SegmentedItem value="all">All</SegmentedItem>
          <SegmentedItem value="mine">Mine</SegmentedItem>
          <SegmentedItem value="review">Review requested</SegmentedItem>
          <SegmentedItem value="agents">Agent-authored</SegmentedItem>
        </Segmented>
        <span className="ml-auto flex gap-1.5">
          <DropdownSelect
            aria-label="Repository"
            value={repositoryId}
            onValueChange={setRepositoryId}
            placeholder="All repositories"
            size="sm"
          >
            <DropdownSelectOption value="">
              All repositories
            </DropdownSelectOption>
            {repositories.map((r) => (
              <DropdownSelectOption key={r.id} value={r.id}>
                {r.fullName}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
          <DropdownSelect
            aria-label="Project"
            value={projectId}
            onValueChange={setProjectId}
            placeholder="All projects"
            size="sm"
          >
            <DropdownSelectOption value="">All projects</DropdownSelectOption>
            {projects
              .filter((p) => !p.archivedAt)
              .map((p) => (
                <DropdownSelectOption key={p.id} value={p.id}>
                  {p.name}
                </DropdownSelectOption>
              ))}
          </DropdownSelect>
        </span>
      </Toolbar>
      {failed.length > 0 && (
        <div className="space-y-1 border-b px-4 py-2">
          {failed.slice(0, 5).map((w) => (
            <WriteStatus key={w.id} write={w} />
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!complete && rows.length === 0 ? (
          <LoadingState label="Loading pull requests" />
        ) : shown.length === 0 ? (
          <EmptyState title={`No ${state} pull requests`}>
            {who === "mine" || who === "review"
              ? "Set your code host login in organization settings → Code hosts so Lictory knows which are yours."
              : "Pull requests of linked repositories appear here as soon as the host reports them."}
          </EmptyState>
        ) : (
          <ul
            aria-label="Pull requests"
            className={cn(column, "divide-y divide-border/70")}
          >
            {shown.map((p) => (
              <PullRequestRow key={p.id} pullRequest={p} owners={owners} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PullRequestRow({
  pullRequest: p,
  owners,
}: {
  pullRequest: CodePullRequestEntity;
  // Members by their code host login (lowercase).
  owners: ReadonlyMap<string, string>;
}) {
  const { organization } = useWorkspace();
  const { agentById } = useFactory();
  const agent = p.agentId ? agentById.get(p.agentId) : undefined;
  const author = owners.get(p.authorLogin?.toLowerCase() ?? "") ?? p.openedById;
  return (
    <ListRow
      href={codePaths.pullRequest(organization.slug, p.id)}
      className="[contain-intrinsic-size:auto_52px] [content-visibility:auto]"
      leading={<PullRequestIcon state={p.state} draft={p.draft} />}
      title={p.title}
      meta={
        <>
          {agent ? (
            <AgentActor
              agent={agent}
              ownerId={p.openedById}
              size={16}
              className="shrink-0"
            />
          ) : author ? (
            <Actor userId={author} size={16} className="shrink-0" />
          ) : (
            // A host login no member has claimed (Code hosts settings).
            <span
              title={`${p.authorLogin ?? "Unknown"} on ${providerLabels[p.provider]}, not linked to a member`}
              className="inline-flex shrink-0"
            >
              <Actor
                person={{
                  id: `login:${p.authorLogin ?? "unknown"}`,
                  name: p.authorLogin ?? "Unknown author",
                }}
                size={16}
              />
            </span>
          )}
          <span aria-hidden>·</span>
          <span className="truncate">
            <span className="font-mono">
              {p.repositoryFullName.split("/").pop()}#{p.number}
            </span>{" "}
            · <span className="font-mono">{p.headBranch}</span> →{" "}
            <span className="font-mono">{p.baseBranch}</span>
          </span>
        </>
      }
      chips={
        <>
          <ItemChips links={p.links} />
          <span className="max-md:hidden">
            {p.state === "open" && <ReviewBadge decision={p.reviewDecision} />}
          </span>
          {/* A fixed column, so the checks line up down the list. */}
          <span className="grid w-5 place-items-center">
            <ChecksIcon state={p.checks.state} />
          </span>
        </>
      }
      time={p.hostUpdatedAt}
    />
  );
}

function Issues() {
  const [state, setState] = useState<"open" | "closed">("open");
  const { rows, complete } = useCodeList("codeIssue", state);
  const shown = [...rows].sort((a, b) =>
    b.hostUpdatedAt.localeCompare(a.hostUpdatedAt),
  );
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <Segmented aria-label="State" value={state} onValueChange={setState}>
          <SegmentedItem value="open">Open</SegmentedItem>
          <SegmentedItem value="closed">Closed</SegmentedItem>
        </Segmented>
        <p className="text-xs text-muted-foreground">
          Issues stay the host’s until someone imports one; the work item is
          then Lictory’s and the issue stays linked.
        </p>
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!complete && rows.length === 0 ? (
          <LoadingState label="Loading issues" />
        ) : shown.length === 0 ? (
          <EmptyState title={`No ${state} issues`}>
            Issues of linked repositories appear here.
          </EmptyState>
        ) : (
          <ul aria-label="Issues" className={cn(column, "divide-y")}>
            {shown.map((i) => (
              <IssueRow key={i.id} issue={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: CodeIssueEntity }) {
  const { organization, projects, capabilitiesIn, items } = useWorkspace();
  const { repositories } = useCodeHosts();
  const router = useRouter();
  const serving = (
    repositories.find((r) => r.id === issue.repositoryId)?.projectIds ?? []
  )
    .map((id) => projects.find((p) => p.id === id))
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p && !p.archivedAt && capabilitiesIn(p.id).changeProperties,
    );
  const [projectId, setProjectId] = useState(serving[0]?.id ?? "");
  const imported = issue.importedWorkItemId
    ? items.find((i) => i.id === issue.importedWorkItemId)
    : undefined;
  const importedProject =
    imported && projects.find((p) => p.id === imported.projectId);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 [contain-intrinsic-size:auto_56px] [content-visibility:auto] hover:bg-muted/50">
      <TargetIcon
        target="issue"
        className={issue.state === "open" ? "text-success" : ""}
      />
      <div className="min-w-0 flex-1">
        <a
          href={issue.webUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 truncate text-[13px] font-medium underline-offset-2 hover:underline"
        >
          <span className="truncate">{issue.title}</span>
          <ArrowUpRight className="size-3 shrink-0" />
        </a>
        <p className="truncate text-xs text-muted-foreground">
          {issue.repositoryFullName}#{issue.number} ·{" "}
          {issue.authorLogin ?? "unknown"} · updated{" "}
          {relativeTime(issue.hostUpdatedAt)}
          {issue.labels.length > 0 && ` · ${issue.labels.join(", ")}`}
        </p>
      </div>
      <ItemChips links={issue.links} />
      {imported && importedProject ? (
        <Link
          href={paths.item(organization.slug, importedProject.key, imported.id)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Imported as {identifier(importedProject, imported.number)}
        </Link>
      ) : (
        serving.length > 0 && (
          <span className="flex items-center gap-1.5">
            {serving.length > 1 && (
              <DropdownSelect
                aria-label="Import into project"
                value={projectId}
                onValueChange={setProjectId}
                size="sm"
              >
                {serving.map((p) => (
                  <DropdownSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const result = await callCapability<{ workItemId: string }>(
                    "importCodeIssue",
                    {
                      organizationId: organization.id,
                      issueId: issue.id,
                      projectId,
                      mutationId: crypto.randomUUID(),
                    },
                  );
                  const project = projects.find((p) => p.id === projectId)!;
                  router.push(
                    paths.item(
                      organization.slug,
                      project.key,
                      result.workItemId,
                    ),
                  );
                } catch (e) {
                  toast({
                    title: "Not imported",
                    description: message(e),
                    type: "error",
                  });
                }
              }}
            >
              Import as work item
            </Button>
          </span>
        )
      )}
    </li>
  );
}

function Repositories() {
  const { organization, projects } = useWorkspace();
  const { repositories, connections } = useCodeHosts();
  if (!repositories.length)
    return (
      <EmptyState
        title="No repository serves a project yet"
        action={
          <Button
            variant="secondary"
            render={<Link href={paths.settings(organization.slug, "code")} />}
          >
            <FolderGit2 className="size-3.5" /> Link a repository
          </Button>
        }
      >
        Project administrators link repositories to their projects in
        organization settings → Code hosts.
      </EmptyState>
    );
  return (
    <div className="h-full overflow-y-auto">
      <ul aria-label="Repositories" className={cn(column, "divide-y")}>
        {repositories.map((r) => {
          const connection = connections.find((c) => c.id === r.connectionId);
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]"
            >
              <FolderGit2
                aria-hidden
                className="size-4 text-muted-foreground"
              />
              <div className="min-w-0 flex-1">
                <a
                  href={r.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  {r.fullName} <ArrowUpRight className="size-3" />
                </a>
                <p className="text-xs text-muted-foreground">
                  {providerLabels[r.provider]}
                  {connection && ` · ${connection.name}`} · {r.visibility} ·
                  default {r.defaultBranch} ·{" "}
                  {r.lastSyncedAt
                    ? `read ${relativeTime(r.lastSyncedAt)}`
                    : "reading…"}
                </p>
                {r.lastSyncError && (
                  <p className="text-xs text-destructive">{r.lastSyncError}</p>
                )}
              </div>
              <span className="flex flex-wrap gap-1">
                {r.projectIds.map((id) => (
                  <Badge key={id} tone="info">
                    {projects.find((p) => p.id === id)?.name ??
                      "Archived project"}
                  </Badge>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
