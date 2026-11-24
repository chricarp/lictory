import { useState } from "react";
import { Bot, Play, Server } from "lucide-react";
import { runnerOnline } from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { EmptyState } from "@lictory/ui/primitives";
import { LoadingState } from "@lictory/ui/spinner";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  ApprovalActions,
  FactoryPage,
  Section,
  SessionList,
} from "@lictory/platform/components/factory/parts";
import { StartSessionDialog } from "@lictory/platform/components/factory/start-session";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";

// What the factory is doing and what is waiting on people: questions
// agents asked me first, then sessions at work, queued and finished.
export function FactoryOverview() {
  const { organization, userId } = useWorkspace();
  const { agents, agentById, runners, sessions, complete } = useFactory();
  const [starting, setStarting] = useState(false);
  const org = organization.slug;
  const waiting = waitingOnMe(sessions, agentById, userId);
  const working = sessions.filter((s) =>
    ["assigned", "running", "waiting"].includes(s.status),
  );
  const queued = sessions.filter((s) => s.status === "queued");
  const finished = sessions
    .filter((s) => ["completed", "failed", "canceled"].includes(s.status))
    .slice(0, 20);
  const online = runners.filter((r) => runnerOnline(r)).length;
  const runnable = agents.filter((a) => a.kind === "runner" && !a.archivedAt);
  return (
    <FactoryPage
      title="Factory"
      description="Agents working on your team’s tasks, on runners you control. People start, steer and approve; agents do the work in between."
      actions={
        <Button onClick={() => setStarting(true)} disabled={!runnable.length}>
          <Play className="size-3.5" aria-hidden /> Start session
        </Button>
      }
    >
      <dl className="grid grid-cols-3 gap-3">
        <Stat
          label="Working"
          value={working.length}
          detail={`${queued.length} queued`}
        />
        <Stat
          label="Runners online"
          value={online}
          detail={`of ${runners.length}`}
          href={factoryPaths.runners(org)}
        />
        <Stat
          label="Agents"
          value={agents.filter((a) => !a.archivedAt).length}
          detail={`${runnable.length} run on runners`}
          href={factoryPaths.agents(org)}
        />
      </dl>
      {!complete && !sessions.length ? (
        <LoadingState label="Loading the factory" />
      ) : !agents.length || !runners.length ? (
        <Setup hasAgents={agents.length > 0} hasRunners={runners.length > 0} />
      ) : null}
      {waiting.length > 0 && (
        <Section title="Waiting on you" count={waiting.length}>
          <ul className="space-y-2">
            {waiting.flatMap((session) =>
              session.approvals.map((approval) => (
                <li
                  key={approval.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-(--shadow-border)"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <div className="text-[13px] font-medium">
                      {approval.title}
                    </div>
                    <Link
                      href={factoryPaths.session(org, session.id)}
                      className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground"
                    >
                      {agentById.get(session.agentId)?.name ?? "Agent"} ·{" "}
                      {session.title}
                    </Link>
                  </div>
                  <ApprovalActions
                    session={session}
                    approval={approval}
                    canAnswer
                  />
                </li>
              )),
            )}
          </ul>
        </Section>
      )}
      <Section title="Working now" count={working.length}>
        <SessionList
          sessions={working}
          agentById={agentById}
          empty={
            queued.length
              ? online
                ? "Sessions are queued; a runner will claim them shortly."
                : "Sessions are queued, but no runner is online to claim them."
              : "No agent is working right now."
          }
        />
      </Section>
      {queued.length > 0 && (
        <Section title="Queued" count={queued.length}>
          <SessionList sessions={queued} agentById={agentById} />
        </Section>
      )}
      <Section title="Recent" count={finished.length}>
        <SessionList
          sessions={finished}
          agentById={agentById}
          empty="Finished sessions appear here, with what they changed."
        />
      </Section>
      {starting && <StartSessionDialog onClose={() => setStarting(false)} />}
    </FactoryPage>
  );
}

function Stat({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
}) {
  const body = (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </dd>
    </>
  );
  const className =
    "block rounded-xl bg-card px-4 py-3 shadow-(--shadow-border) outline-none focus-visible:ring-2 focus-visible:ring-ring/60";
  return href ? (
    <div>
      <Link href={href} className={`${className} hover:bg-muted/50`}>
        {body}
      </Link>
    </div>
  ) : (
    <div className={className}>{body}</div>
  );
}

// First use: what to connect, in order.
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
    <EmptyState
      title="Set up the factory"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {!hasRunners && (
            <Button render={<Link href={factoryPaths.runners(org)} />}>
              <Server className="size-3.5" aria-hidden /> Add a runner
            </Button>
          )}
          {!hasAgents && (
            <Button
              variant={hasRunners ? "primary" : "secondary"}
              render={<Link href={factoryPaths.agents(org)} />}
            >
              <Bot className="size-3.5" aria-hidden /> Create an agent
            </Button>
          )}
        </div>
      }
    >
      A runner is a machine you control (a server, a laptop, a Mac mini) that
      runs coding agents such as Claude Code or Codex. An agent is a named
      member with an owner who is accountable for it. Add one of each to start
      sessions.
    </EmptyState>
  );
}
