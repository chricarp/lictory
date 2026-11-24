import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  Factory,
  Hand,
  History,
  Play,
  Server,
  Zap,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { runnerOnline } from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { LoadingState } from "@lictory/ui/spinner";
import { MissingState } from "@lictory/ui/status-page";
import {
  Link,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import { AgentAvatar } from "@lictory/platform/components/identity/actor";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  FactoryPage,
  SessionRow,
  titleBeside,
  useItemKey,
  useSessionStateOf,
} from "@lictory/platform/components/factory/parts";
import { StartSessionDialog } from "@lictory/platform/components/factory/start-session";
import { useFactory } from "@lictory/platform/components/factory/store";
import { overviewBlocks } from "@lictory/platform/components/factory/overview-blocks";

// What the factory is doing, in three blocks, each session in exactly one:
// what needs me (an agent's request, reviewed with its context), what is
// running, and what finished recently with what it changed. The counts sit
// in the header; a new organization sees one setup path instead.

const RECENT = 20;

export function FactoryOverview() {
  const { organization, userId } = useWorkspace();
  const { agents, agentById, runners, runnerById, sessions, complete } =
    useFactory();
  // `?start=<work item id>` opens the dialog for that item (an item's page
  // links here); `?start=new` opens it empty.
  const search = useSearchParams();
  const router = useRouter();
  const startParam = search.get("start");
  const [starting, setStarting] = useState(Boolean(startParam));
  const close = () => {
    setStarting(false);
    if (startParam) router.replace(factoryPaths.overview(organization.slug));
  };
  const stateOf = useSessionStateOf();
  const itemKey = useItemKey();
  const org = organization.slug;
  const blocks = useMemo(
    () => overviewBlocks(sessions, agentById, userId),
    [sessions, agentById, userId],
  );
  const online = runners.filter((r) => !r.revokedAt && runnerOnline(r)).length;
  const active = runners.filter((r) => !r.revokedAt).length;
  const runnable = agents.filter((a) => a.kind === "runner" && !a.archivedAt);
  const description =
    "Agents working on your team’s tasks, on runners you control. People start, steer and approve; agents do the work in between.";
  const start = (
    <Button
      onClick={() => setStarting(true)}
      disabled={!runnable.length}
      aria-label="Start session"
    >
      <Play className="size-3.5" aria-hidden />
      <span className="max-sm:hidden">Start session</span>
    </Button>
  );

  if (!complete && !sessions.length && !agents.length)
    return (
      <FactoryPage description={description}>
        <LoadingState label="Loading the factory" />
      </FactoryPage>
    );
  // A factory needs a runner and an agent before anything can happen.
  if (!sessions.length && (!runnable.length || !active))
    return (
      <FactoryPage description={description}>
        <Setup hasAgents={runnable.length > 0} hasRunners={active > 0} />
      </FactoryPage>
    );

  const counts = [
    blocks.needsYou.length > 0 &&
      `${blocks.needsYou.length} ${blocks.needsYou.length === 1 ? "needs" : "need"} you`,
    `${blocks.running.filter((s) => s.status !== "queued").length} running`,
    blocks.queued > 0 && `${blocks.queued} queued`,
    `${online} of ${active} ${active === 1 ? "runner" : "runners"} online`,
  ].filter(Boolean);
  const recent = blocks.recent.slice(0, RECENT);
  return (
    <FactoryPage
      description={description}
      meta={<span data-factory-counts>{counts.join(" · ")}</span>}
      actions={start}
    >
      <Panel
        title="Needs you"
        icon={<Hand />}
        count={blocks.needsYou.length}
        empty="Nothing waits on you. Agents ask here when they need a decision."
      >
        {blocks.needsYou.flatMap((session) => {
          const agent = agentById.get(session.agentId);
          if (!session.approvals.length)
            // Waiting for my next message, not for a decision.
            return [
              <ListRow
                key={session.id}
                href={factoryPaths.session(org, session.id)}
                leading={
                  agent ? <AgentAvatar agent={agent} size={20} /> : undefined
                }
                identifier={itemKey(session.workItemId)}
                title={titleBeside(session.title, itemKey(session.workItemId))}
                meta="Waiting for your next message"
                chips={<SessionStateChip state={stateOf(session, agent)} />}
                time={session.updatedAt}
              />,
            ];
          return session.approvals.map((approval) => (
            <ApprovalRequest
              key={approval.id}
              compact
              session={session}
              approval={approval}
              agent={agent}
              runner={
                session.runnerId ? runnerById.get(session.runnerId) : undefined
              }
            />
          ));
        })}
      </Panel>
      <Panel
        title="Running"
        icon={<Zap />}
        count={blocks.running.length}
        empty={
          blocks.queued
            ? online
              ? "Sessions are queued; a runner will claim them shortly."
              : "Sessions are queued, but no runner is online to claim them."
            : "No agent is working right now."
        }
      >
        {blocks.running.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            agent={agentById.get(session.agentId)}
          />
        ))}
      </Panel>
      <Panel
        title="Recent"
        icon={<History />}
        count={blocks.recent.length}
        empty="Finished sessions appear here, with what they changed."
      >
        {recent.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            agent={agentById.get(session.agentId)}
            showOutcome
          />
        ))}
      </Panel>
      {starting && (
        <StartSessionDialog
          onClose={close}
          workItemId={
            startParam && startParam !== "new" ? startParam : undefined
          }
        />
      )}
    </FactoryPage>
  );
}

// First use: one path, in order (a runner, then an agent).
function Setup({
  hasAgents,
  hasRunners,
}: {
  hasAgents: boolean;
  hasRunners: boolean;
}) {
  const { organization } = useWorkspace();
  const org = organization.slug;
  return (
    <MissingState
      headingLevel={2}
      icon={Factory}
      title="Set up the factory"
      action={
        !hasRunners ? (
          <Button render={<Link href={factoryPaths.runners(org)} />}>
            <Server className="size-3.5" aria-hidden /> Add a runner
          </Button>
        ) : (
          <Button render={<Link href={factoryPaths.agents(org)} />}>
            <Bot className="size-3.5" aria-hidden /> Create an agent
          </Button>
        )
      }
    >
      <ol className="mt-2 space-y-2 text-left">
        <SetupStep n={1} done={hasRunners}>
          Add a runner: a machine you control (a server, a laptop, a Mac mini)
          that runs coding agents such as Claude Code or Codex.
        </SetupStep>
        <SetupStep n={2} done={hasAgents}>
          Create an agent: a named member with an owner who is accountable for
          it.
        </SetupStep>
        <SetupStep n={3} done={false}>
          Start a session, or mention the agent in a channel.
        </SetupStep>
      </ol>
    </MissingState>
  );
}

function SetupStep({
  n,
  done,
  children,
}: {
  n: number;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
          done
            ? "bg-success/12 text-success"
            : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : n}
      </span>
      <span className={done ? "text-muted-foreground" : "text-foreground"}>
        {done && <span className="sr-only">Done: </span>}
        {children}
      </span>
    </li>
  );
}
