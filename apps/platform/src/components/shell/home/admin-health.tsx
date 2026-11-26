import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CircleOff,
  GitBranch,
  MessageSquare,
  Server,
  Wrench,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { runnerOnline, waitsForRunner } from "@lictory/core/factory/entities";
import { paths } from "@lictory/core/lib/paths";
import { relativeTime } from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useFactory } from "@lictory/platform/components/factory/store";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";

// What the organization's administrators must fix for the factory to keep
// working, on their Home: organization runners that are offline or were
// never started, queued sessions no runner can take, and code host or Slack
// connections that stopped working. The instance's monitor alerts its
// operator about the same things (docs/operations/deployment.md); the
// administrator who can fix them is often someone else, so the product says
// it where they look. Nothing here is a setting; it is derived state, and
// the card renders nothing while all is well.

type SlackHealth = { status: string; lastError: string | null };

// A runner registered this long ago that never connected was forgotten,
// not still being installed.
const NOT_STARTED_GRACE = 15 * 60_000;

const noSubscribe = () => () => undefined;
const currentMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function AdminHealthCard() {
  const { organization, isAdmin } = useWorkspace();
  if (!isAdmin) return null;
  return <Health key={organization.id} />;
}

function Health() {
  const { organization } = useWorkspace();
  const { runners, sessions, agentById } = useFactory();
  const { connections } = useCodeHosts();
  const slack = useSlackHealth();
  const org = organization.slug;
  // A minute is precise enough for "offline": a stable snapshot of the
  // clock, read again with synchronized changes.
  const now = useSyncExternalStore(noSubscribe, currentMinute, () => 0);
  const down = runners.filter((runner) => {
    if (runner.revokedAt || runner.personal || runnerOnline(runner, now))
      return false;
    const started = runner.lastSeenAt !== runner.registeredAt;
    return started || now - Date.parse(runner.registeredAt) > NOT_STARTED_GRACE;
  });
  const stranded = sessions.filter((s) =>
    waitsForRunner(s, agentById.get(s.agentId), runners, now),
  );
  const brokenHosts = connections.filter((c) => c.status === "invalid");
  const rows = [
    ...down.map((runner) => {
      const started = runner.lastSeenAt !== runner.registeredAt;
      return (
        <ListRow
          key={`runner:${runner.id}`}
          href={factoryPaths.runners(org)}
          leading={<CircleOff aria-hidden className="text-destructive" />}
          title={
            started
              ? `Runner ${runner.name} is offline`
              : `Runner ${runner.name} was never started`
          }
          meta={
            started && runner.lastSeenAt
              ? `Last seen ${relativeTime(runner.lastSeenAt)}. Its sessions wait until it is back.`
              : "Registered, but it has not connected since. Start lictory-runner on the machine."
          }
        />
      );
    }),
    stranded.length > 0 && (
      <ListRow
        key="stranded"
        href={factoryPaths.overview(org)}
        leading={<Server aria-hidden className="text-warning" />}
        title={
          stranded.length === 1
            ? "1 queued session waits for a runner"
            : `${stranded.length} queued sessions wait for a runner`
        }
        meta="No online runner has the agent's harness. Start a runner, or add one that has it."
      />
    ),
    ...brokenHosts.map((connection) => (
      <ListRow
        key={`code:${connection.id}`}
        href={paths.settings(org, "code")}
        leading={<GitBranch aria-hidden className="text-destructive" />}
        title={`${connection.name} needs attention`}
        meta={
          connection.lastError ??
          "Its credential stopped working: pull requests, checks and agents' pushes stop until it is replaced."
        }
      />
    )),
    slack?.status === "invalid" && (
      <ListRow
        key="slack"
        href={paths.settings(org, "integrations")}
        leading={<MessageSquare aria-hidden className="text-destructive" />}
        title="Slack needs attention"
        meta={
          slack.lastError ??
          "Slack refused the app's token: linked channels stop mirroring until it is reinstalled."
        }
      />
    ),
  ].filter(Boolean);
  return (
    <Panel title="Needs an administrator" icon={<Wrench />} count={rows.length}>
      {rows}
    </Panel>
  );
}

// The Slack connection's state is read once, not synchronized: it changes
// rarely, and only administrators read it.
function useSlackHealth() {
  const { organization } = useWorkspace();
  const [health, setHealth] = useState<SlackHealth | null>(null);
  useEffect(() => {
    let live = true;
    callCapability<{ connection: SlackHealth }>("getSlackConnection", {
      organizationId: organization.id,
    })
      .then((reading) => {
        if (live) setHealth(reading.connection);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [organization.id]);
  return health;
}
