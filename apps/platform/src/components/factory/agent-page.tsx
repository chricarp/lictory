import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  History,
  Info,
  Pencil,
  Play,
  RotateCcw,
} from "lucide-react";
import type { AgentEntity } from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { StatusChip } from "@lictory/ui/status-chip";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { identifier } from "@lictory/core/lib/work-items";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  Actor,
  AgentAvatar,
} from "@lictory/platform/components/identity/actor";
import { SessionRow } from "@lictory/platform/components/factory/parts";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { useFactory } from "@lictory/platform/components/factory/store";
import { useChannels } from "@lictory/platform/components/channels/store";
import { channelLabel } from "@lictory/platform/components/channels/data";
import { StartSessionDialog } from "@lictory/platform/components/factory/start-session";
import {
  AgentDialog,
  agentKindLabel,
  toggleArchived,
} from "@lictory/platform/components/factory/agents";
import {
  AgentConnection,
  AgentWakeUps,
  hasHandedOverSecret,
} from "@lictory/platform/components/factory/agent-connection";

// One agent: what it is (owner, kind, scope), its recent sessions and, for
// its owner, everything that connects it (Connection and Wake-ups). It is
// the one place for an agent: Account settings only points here.
export function AgentPage() {
  const { agent: agentId = "" } = useParams<{ agent: string }>();
  const { organization, userId, isAdmin } = useWorkspace();
  const { agentById, sessions, complete } = useFactory();
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const agent = agentById.get(agentId);
  const org = organization.slug;
  const back = { label: "Back to agents", href: factoryPaths.agents(org) };
  const own = useMemo(
    () => sessions.filter((s) => s.agentId === agentId).slice(0, 10),
    [sessions, agentId],
  );

  // Open on the section the address names (#connection, #wake-ups), once
  // the agent is there to draw it.
  const ready = Boolean(agent);
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [ready]);

  if (!agent)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title="Agent" back={back} />
        {/* A just-created agent arrives through sync a moment later. */}
        {complete && !hasHandedOverSecret(agentId) ? (
          <EmptyState title="This agent does not exist">
            It may belong to another organization.{" "}
            <Link href={back.href} className="underline">
              Back to agents
            </Link>
          </EmptyState>
        ) : (
          <LoadingState label="Loading the agent" />
        )}
      </div>
    );

  const mine = agent.ownerId === userId;
  const archived = Boolean(agent.archivedAt);
  const canStart =
    agent.kind === "runner" && !archived && (mine || agent.shared);
  const canArchive = (mine || isAdmin) && agent.kind !== "intelligence";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        back={back}
        icon={<AgentAvatar agent={agent} size={20} />}
        title={agent.name}
        meta={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono">@{agent.handle}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{agentKindLabel(agent)}</span>
          </span>
        }
        actions={
          <>
            {archived && (
              <StatusChip tone="neutral" icon={<Archive />}>
                Archived
              </StatusChip>
            )}
            {canStart && (
              <Button variant="secondary" onClick={() => setStarting(true)}>
                <Play className="size-3.5" aria-hidden /> Start
              </Button>
            )}
            {mine && !archived && (
              <Button
                variant="ghost"
                aria-label={`Edit ${agent.name}`}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" aria-hidden />
                <span className="max-sm:hidden">Edit</span>
              </Button>
            )}
            {canArchive && (
              <Button
                variant="ghost"
                aria-label={
                  archived ? `Restore ${agent.name}` : `Archive ${agent.name}`
                }
                onClick={() => void toggleArchived(organization.id, agent)}
              >
                {archived ? (
                  <RotateCcw className="size-3.5" aria-hidden />
                ) : (
                  <Archive className="size-3.5" aria-hidden />
                )}
                <span className="max-sm:hidden">
                  {archived ? "Restore" : "Archive"}
                </span>
              </Button>
            )}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-6 pb-16 sm:px-8">
          <About agent={agent} />
          {agent.kind !== "intelligence" &&
            (mine ? (
              agent.kind === "external" ? (
                <>
                  <AgentConnection agent={agent} />
                  <AgentWakeUps agent={agent} />
                </>
              ) : (
                <AgentConnection agent={agent} optional />
              )
            ) : (
              agent.kind === "external" && (
                <Panel
                  title="Connection"
                  empty={
                    <>
                      Only <Actor userId={agent.ownerId} size={16} /> connects{" "}
                      {agent.name} and decides what wakes it: its tokens act
                      with their permissions.
                    </>
                  }
                />
              )
            ))}
          <Panel title="Recent sessions" icon={<History />} count={own.length}>
            {own.map((session) => (
              <SessionRow key={session.id} session={session} agent={agent} />
            ))}
          </Panel>
          {mine && agent.kind !== "intelligence" && (
            <RecentActivity agent={agent} />
          )}
        </div>
      </div>
      {editing && (
        <AgentDialog agent={agent} onClose={() => setEditing(false)} />
      )}
      {starting && (
        <StartSessionDialog
          agentId={agent.id}
          onClose={() => setStarting(false)}
        />
      )}
    </div>
  );
}

// Who is accountable for the agent and what it may reach.
function About({ agent }: { agent: AgentEntity }) {
  const { directory } = useWorkspace();
  const projects = agent.projectIds
    ?.map((id) => directory.projects.find((p) => p.id === id))
    .filter(Boolean);
  const facts: [string, ReactNode][] = [
    [
      "Owner",
      // The accountable person is never the part that is cut: on a
      // narrow screen the explanation wraps below the name instead.
      <span
        key="owner"
        className="inline-flex flex-wrap items-center gap-x-1.5"
      >
        <Actor userId={agent.ownerId} size={16} className="shrink-0" />
        <span className="text-muted-foreground">
          · acts with their permissions
        </span>
      </span>,
    ],
    ["Kind", agentKindLabel(agent)],
    ...(agent.model
      ? ([
          [
            "Model",
            <span key="model" className="font-mono text-xs">
              {agent.model}
            </span>,
          ],
        ] as [string, ReactNode][])
      : []),
    ["Access", agent.access === "read" ? "Read only" : "Read and write"],
    [
      "Projects",
      projects?.length
        ? projects.map((p) => p!.key).join(", ")
        : "Every project",
    ],
    ...(agent.kind === "runner"
      ? ([
          [
            "Sessions",
            agent.shared
              ? "Anyone in the organization may start them"
              : "Only its owner starts them",
          ],
        ] as [string, ReactNode][])
      : []),
  ];
  return (
    <Panel title="About" icon={<Info />}>
      {agent.description && (
        <li className="px-3.5 py-3 text-[13px] leading-5">
          {agent.description}
        </li>
      )}
      <li className="px-3.5 py-3">
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </li>
    </Panel>
  );
}

type AgentCall = {
  id: string;
  at: string;
  capability: string;
  outcome: string;
  durationMs: number;
  tokenName: string;
  sessionId: string | null;
  // The subject it named and, when refused, what it was told.
  detail: {
    target?: { field: string; id: string };
    message?: string;
    kind?: string;
  } | null;
};

// "Scout is an agent: “Decide review” is a person's decision, made in the
// work item's specification → Reviews (Approve or Request changes). …" →
// its first sentence. A period inside parentheses or a name does not end it.
function firstSentence(text: string) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "“") depth++;
    else if ((c === ")" || c === "”") && depth > 0) depth--;
    else if (
      c === "." &&
      depth === 0 &&
      (i + 1 === text.length || text[i + 1] === " ")
    )
      return text.slice(0, i + 1);
  }
  return text;
}

const targetNouns: Record<string, string> = {
  sessionId: "session",
  pullRequestId: "pull request",
  claimId: "claim",
  reviewId: "review",
  threadId: "discussion",
  suggestionId: "suggestion",
  specificationId: "specification",
  pageId: "page",
  channelId: "channel",
  projectId: "project",
  agentId: "agent",
  runnerId: "runner",
};

// What the agent did with its tokens, as Lictory recorded it: each tool it
// called, what it named, when, and whether it worked, with the refusal it
// got (inputs are never recorded). Its owner's view; administrators see
// every agent's calls in the audit log.
function RecentActivity({ agent }: { agent: AgentEntity }) {
  const { organization, items, projects, memberName } = useWorkspace();
  const { byId: channelById } = useChannels();
  const { agentById, sessions } = useFactory();
  // What the call named, by its name: a work item by its key, a channel
  // as "#field-devices", a project, an agent or a session by name. An id
  // only for what this browser cannot name.
  const targetLabel = (target: { field: string; id: string } | undefined) => {
    if (!target) return null;
    if (target.field === "workItemId" || target.field === "key") {
      const item = items.find((i) => i.id === target.id);
      const project = item && projects.find((p) => p.id === item.projectId);
      return item && project
        ? identifier(project, item.number)
        : target.id.toUpperCase();
    }
    const channel =
      target.field === "channelId" ? channelById.get(target.id) : undefined;
    const name = channel
      ? channelLabel(
          channel,
          memberName,
          (id) => agentById.get(id)?.name ?? "agent",
        )
      : target.field === "projectId"
        ? projects.find((p) => p.id === target.id)?.key
        : target.field === "agentId"
          ? agentById.get(target.id)?.name
          : target.field === "sessionId"
            ? sessions.find((s) => s.id === target.id)?.title
            : undefined;
    if (name) return channel && channel.kind !== "direct" ? `#${name}` : name;
    return `${targetNouns[target.field] ?? "on"} ${target.id.slice(0, 8)}`;
  };
  const [calls, setCalls] = useState<AgentCall[] | null>(null);
  useEffect(() => {
    let live = true;
    callCapability<{ calls: AgentCall[] }>("listAgentActivity", {
      organizationId: organization.id,
      agentId: agent.id,
    }).then(
      (result) => live && setCalls(result.calls),
      () => live && setCalls([]),
    );
    return () => {
      live = false;
    };
  }, [organization.id, agent.id]);
  if (!calls) return null;
  return (
    <Panel
      title="Recent activity"
      icon={<Activity />}
      count={calls.length}
      // A runner agent works in sessions (their transcripts say what it
      // did); this lists only its calls to Lictory's own tools.
      empty={
        agent.kind === "runner"
          ? `${agent.name}'s sessions have not called Lictory's tools yet. What it did in each session is in the session's transcript.`
          : `${agent.name} has not called Lictory with its tokens yet.`
      }
    >
      {calls.map((call) => (
        <ListRow
          key={call.id}
          identifier={targetLabel(call.detail?.target) ?? undefined}
          title={<span className="font-mono text-xs">{call.capability}</span>}
          meta={
            call.detail?.message ? (
              // One line per call: the refusal's first sentence says what
              // was refused and where a person does it; the rest (the rule
              // and what the agent may do instead) is for the agent, and
              // stays one hover or focus away.
              <span title={call.detail.message} className="truncate">
                {firstSentence(call.detail.message)}
              </span>
            ) : (
              `${call.sessionId ? "A session's token" : call.tokenName} · ${call.durationMs} ms`
            )
          }
          chips={
            call.outcome === "ok" ? undefined : (
              <StatusChip tone="danger">
                {call.outcome === "server" || call.outcome === "external"
                  ? "Failed"
                  : "Refused"}
                : {call.outcome.replaceAll("_", " ")}
              </StatusChip>
            )
          }
          time={call.at}
        />
      ))}
    </Panel>
  );
}
