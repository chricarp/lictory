import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  Factory,
  Hand,
  History,
  Play,
  Server,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { runnerOnline, waitsForRunner } from "@lictory/core/factory/entities";
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
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  FactoryPage,
  SessionRow,
} from "@lictory/platform/components/factory/parts";
import { StartSessionDialog } from "@lictory/platform/components/factory/start-session";
import { harnessLabel } from "@lictory/platform/components/factory/labels";
import { useFactory } from "@lictory/platform/components/factory/store";
import {
  agentsWaitingLabel,
  overviewBlocks,
} from "@lictory/platform/components/factory/overview-blocks";
import {
  WaitingRowView,
  useWaitingOnYou,
} from "@lictory/platform/components/workspace/inbox";

// What the factory is doing, in blocks, each session in exactly one: what
// needs me (an agent's request, reviewed with its context), what waits on a
// teammate, what is running, and what finished recently with what it
// changed. The counts sit
// in the header; a new organization sees one setup path instead.

const RECENT = 20;

export function FactoryOverview() {
  const { organization, userId } = useWorkspace();
  const { agents, agentById, runners, sessions, complete } = useFactory();
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
  const org = organization.slug;
  const blocks = useMemo(
    () => overviewBlocks(sessions, agentById, userId),
    [sessions, agentById, userId],
  );
  // What agents ask me: one row per question, one for a session waiting for
  // my next message, one for a session of mine that failed.
  const waiting = useWaitingOnYou();
  const asks = useMemo(
    () => waiting.filter((row) => row.kind === "agent"),
    [waiting],
  );
  const online = runners.filter((r) => !r.revokedAt && runnerOnline(r)).length;
  const active = runners.filter((r) => !r.revokedAt).length;
  const runnable = agents.filter((a) => a.kind === "runner" && !a.archivedAt);
  const description =
    "Agents working on your team’s tasks, on runners you control. People start, steer and approve; agents do the work in between.";
  const start = (
    <Button onClick={() => setStarting(true)} disabled={!runnable.length}>
      <Play className="size-3.5" aria-hidden />
      Start session
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
    // Only the agents' part of the queue Home and the Inbox count, said as
    // a part of that total so the numbers reconcile.
    agentsWaitingLabel(asks.length, waiting.length),
    blocks.waitingOnOthers.length > 0 &&
      `${blocks.waitingOnOthers.length} waiting on teammates`,
    `${blocks.running.filter((s) => s.status !== "queued").length} running`,
    blocks.queued > 0 && `${blocks.queued} queued`,
    `${online} of ${active} ${active === 1 ? "runner" : "runners"} online`,
  ].filter(Boolean);
  const recent = blocks.recent.slice(0, RECENT);
  // Queued work no online runner can take waits silently otherwise.
  const stranded = blocks.running.filter((s) =>
    waitsForRunner(s, agentById.get(s.agentId), runners),
  );
  const strandedAgents = [
    ...new Set(
      stranded.map((s) => {
        const agent = agentById.get(s.agentId);
        return agent
          ? `${agent.name} (${harnessLabel(agent.harness)})`
          : "its agent";
      }),
    ),
  ];
  return (
    <FactoryPage
      description={description}
      meta={<span data-factory-counts>{counts.join(" · ")}</span>}
      actions={start}
    >
      {stranded.length > 0 && (
        <div
          role="status"
          data-no-runner
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warning/8 px-4 py-3 text-[13px] ring-1 ring-warning/25 ring-inset"
        >
          <Server
            className="size-4 shrink-0 text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]"
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            {stranded.length === 1
              ? "1 queued session waits for a runner"
              : `${stranded.length} queued sessions wait for a runner`}
            : no online runner can run {strandedAgents.join(", ")}. Start one,
            or add a runner that has the harness.
          </span>
          <Button
            size="sm"
            variant="secondary"
            render={<Link href={factoryPaths.runners(org)} />}
          >
            Runners
          </Button>
        </div>
      )}
      {/* One queue: the agents' rows of the Inbox's To do (and Home's
          "Waiting on you"), the same rows answered the same way here, so
          the Factory, Home and the Inbox never disagree. */}
      <Panel
        title="Agents need you"
        icon={<Hand />}
        count={asks.length}
        more={{
          label:
            waiting.length > asks.length
              ? `All ${waiting.length} waiting on you in Inbox`
              : "Inbox",
          href: paths.inbox(org, "todo"),
        }}
        empty="Nothing waits on you. When an agent needs a decision or your next message, it appears here and in your Inbox."
      >
        {asks.map((row) => (
          <WaitingRowView key={row.key} row={row} />
        ))}
      </Panel>
      {/* The team's view: agents held up by someone else, and by whom. */}
      <Panel
        title="Waiting on teammates"
        icon={<Users />}
        count={blocks.waitingOnOthers.length}
      >
        {blocks.waitingOnOthers.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            agent={agentById.get(session.agentId)}
          />
        ))}
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
      illustration="planning"
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
