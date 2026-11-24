import { useState } from "react";
import {
  Box,
  CircleOff,
  Copy,
  Laptop,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  runnerOnline,
  type RunnerEntity,
} from "@lictory/core/factory/entities";
import { harnessLabels, type HarnessId } from "@lictory/core/factory/protocol";
import { APP_VERSION } from "@lictory/core/lib/app-version";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Dialog } from "@lictory/ui/dialog";
import { MissingState } from "@lictory/ui/status-page";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { osLabel } from "@lictory/platform/components/factory/labels";
import { FactoryPage } from "@lictory/platform/components/factory/parts";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { useFactory } from "@lictory/platform/components/factory/store";
import {
  runnerInstallCommand,
  type RunnerSystem,
} from "@lictory/platform/components/factory/runner-install";

// Runners: machines the team controls that execute agent sessions. They
// connect out to Lictory, so they need no open port.
export function FactoryRunners() {
  const { userId, isAdmin, memberName } = useWorkspace();
  const { runners, sessions } = useFactory();
  const [adding, setAdding] = useState(false);
  const active = runners.filter((r) => !r.revokedAt);
  const busy = (runner: RunnerEntity) =>
    sessions.filter(
      (s) =>
        s.runnerId === runner.id &&
        ["assigned", "running", "waiting"].includes(s.status),
    ).length;
  const organization = active.filter((r) => !r.personal);
  const personal = active.filter((r) => r.personal);
  const online = active.filter((r) => runnerOnline(r)).length;
  const row = (runner: RunnerEntity) => (
    <RunnerRow
      key={runner.id}
      runner={runner}
      sessions={busy(runner)}
      owner={runner.ownerId ? memberName(runner.ownerId) : null}
      canRevoke={
        runner.ownerId ? runner.ownerId === userId || isAdmin : isAdmin
      }
    />
  );
  return (
    <FactoryPage
      description="Machines you control that run agent sessions, each in its own git worktree. Organization runners run anyone’s agents; personal runners only their owner’s."
      meta={
        active.length > 0 && (
          <span>
            {online} of {active.length} online
          </span>
        )
      }
      actions={
        <Button onClick={() => setAdding(true)} aria-label="Add runner">
          <Plus className="size-3.5" aria-hidden />
          <span className="max-sm:hidden">Add runner</span>
        </Button>
      }
    >
      {!active.length ? (
        <MissingState
          headingLevel={2}
          icon={Server}
          title="No runners yet"
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden /> Add runner
            </Button>
          }
        >
          Install <code className="font-mono text-xs">lictory-runner</code> on a
          server, a VPS, a laptop or a Mac and register it with a one-time
          token. It connects out over HTTPS and works behind NAT.
        </MissingState>
      ) : (
        <>
          <Panel
            title="Organization runners"
            count={organization.length}
            empty="None. An administrator adds runners everyone’s agents can use."
          >
            {organization.map(row)}
          </Panel>
          <Panel title="Personal runners" count={personal.length}>
            {personal.map(row)}
          </Panel>
        </>
      )}
      {adding && <AddRunnerDialog onClose={() => setAdding(false)} />}
    </FactoryPage>
  );
}

// "3 of 6 sessions" as a short bar, so a full runner reads at a glance.
function Capacity({ used, max }: { used: number; max: number }) {
  const share = max > 0 ? Math.min(1, used / max) : 0;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span
        role="meter"
        aria-label="Sessions running"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${max} sessions`}
        className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/8 ring-inset max-md:hidden"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            share >= 1 ? "bg-warning" : "bg-ring",
          )}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className="max-sm:hidden">
        {used} of {max} sessions
      </span>
      <span className="sm:hidden" aria-hidden>
        {used}/{max}
      </span>
    </span>
  );
}

function RunnerRow({
  runner,
  sessions,
  owner,
  canRevoke,
}: {
  runner: RunnerEntity;
  sessions: number;
  owner: string | null;
  canRevoke: boolean;
}) {
  const { organization } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const online = runnerOnline(runner);
  const revoke = async () => {
    try {
      await callCapability("revokeRunner", {
        organizationId: organization.id,
        runnerId: runner.id,
      });
      setConfirming(false);
    } catch (error) {
      toast({
        type: "error",
        title: "The runner was not removed",
        description: (error as Error).message,
      });
    }
  };
  const Icon = runner.personal ? Laptop : Server;
  return (
    <>
      <ListRow
        // Phones keep the name: the time gives way.
        className="max-sm:[&>time]:hidden"
        leading={<Icon aria-hidden className="text-muted-foreground" />}
        title={<span className="font-medium">{runner.name}</span>}
        meta={
          <>
            {owner && <span className="shrink-0">{owner}’s</span>}
            {owner && <span aria-hidden>·</span>}
            <span className="shrink-0">
              {osLabel(runner.os)} {runner.arch}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">
              {runner.harnesses.length
                ? runner.harnesses
                    .map((h) => harnessLabels[h.id as HarnessId] ?? h.id)
                    .join(", ")
                : "No harness found"}
            </span>
            {runner.version && (
              <span className="shrink-0 font-mono">v{runner.version}</span>
            )}
          </>
        }
        chips={
          <>
            <Capacity used={sessions} max={runner.maxSessions} />
            {runner.isolation === "container" && (
              <StatusChip tone="neutral" icon={<Box />}>
                Containers
              </StatusChip>
            )}
            <StatusChip
              tone={online ? "success" : "neutral"}
              icon={online ? <StatusDot /> : <CircleOff />}
              title={
                runner.lastSeenAt
                  ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}`
                  : "It has never connected."
              }
            >
              {online ? "Online" : "Offline"}
            </StatusChip>
          </>
        }
        time={
          runner.lastSeenAt
            ? {
                iso: runner.lastSeenAt,
                label: online
                  ? `Seen ${relativeTime(runner.lastSeenAt)}`
                  : `Last seen ${relativeTime(runner.lastSeenAt)}`,
              }
            : undefined
        }
        actions={
          canRevoke && !confirming ? (
            <Button
              variant="ghost"
              onClick={() => setConfirming(true)}
              aria-label={`Remove ${runner.name}…`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              <span className="max-sm:hidden">Remove runner…</span>
            </Button>
          ) : undefined
        }
      />
      {confirming && (
        <li
          role="alert"
          className="flex flex-wrap items-center gap-2 bg-destructive/5 px-3.5 py-2.5 text-[13px]"
        >
          <span className="mr-auto">
            Remove <span className="font-medium">{runner.name}</span>? Its
            credential stops working and its sessions return to the queue.
          </span>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button variant="danger" onClick={revoke}>
            Remove runner
          </Button>
        </li>
      )}
    </>
  );
}

function AddRunnerDialog({ onClose }: { onClose: () => void }) {
  const { organization, isAdmin } = useWorkspace();
  const [personal, setPersonal] = useState(!isAdmin);
  const [token, setToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [system, setSystem] = useState<RunnerSystem>(() =>
    navigator.platform.startsWith("Mac")
      ? "macos"
      : navigator.platform.startsWith("Win")
        ? "windows"
        : "linux",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const create = async () => {
    setPending(true);
    setError(null);
    try {
      setToken(
        await callCapability<{ token: string; expiresAt: string }>(
          "createRunnerRegistration",
          {
            organizationId: organization.id,
            personal,
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const commands = token
    ? runnerInstallCommand(
        system,
        window.location.origin,
        token.token,
        APP_VERSION,
      )
    : "";
  return (
    <Dialog
      title="Add a runner"
      description="A runner connects out to Lictory over HTTPS and runs agent sessions in isolated git worktrees on that machine."
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <Button variant={token ? "primary" : "ghost"} onClick={onClose}>
          {token ? "Done" : "Cancel"}
        </Button>
      }
    >
      {!token ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice
              selected={!personal}
              disabled={!isAdmin}
              onSelect={() => setPersonal(false)}
              icon={<Server className="size-4" aria-hidden />}
              title="Organization runner"
              detail={
                isAdmin
                  ? "Runs any agent of the organization."
                  : "Only an organization administrator can add one."
              }
            />
            <Choice
              selected={personal}
              onSelect={() => setPersonal(true)}
              icon={<Laptop className="size-4" aria-hidden />}
              title="Personal runner"
              detail="Runs only your own agents, for example on your laptop."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You get a one-time registration token, valid for an hour. The runner
            exchanges it for its own credential, which you can revoke here.
          </p>
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <Button onClick={create} disabled={pending}>
            {pending ? "Creating…" : "Create registration token"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Segmented
            value={system}
            onValueChange={setSystem}
            aria-label="Operating system"
          >
            <SegmentedItem value="linux">Linux</SegmentedItem>
            <SegmentedItem value="macos">macOS</SegmentedItem>
            <SegmentedItem value="windows">Windows</SegmentedItem>
          </Segmented>
          <div className="relative">
            <pre
              aria-label="Install and register commands"
              className="overflow-x-auto rounded-lg bg-muted/60 p-3 pr-20 font-mono text-[12px] leading-5 whitespace-pre"
            >
              {commands}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={() => {
                void navigator.clipboard.writeText(commands);
                toast({ title: "Commands copied" });
              }}
            >
              <Copy className="size-3.5" aria-hidden /> Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The token works once and expires {relativeTime(token.expiresAt)}.
            The installer checks the download against the release&apos;s
            checksums, registers the runner and keeps it running as a service.
            Install Claude Code or Codex on the machine for those agents;{" "}
            <code className="font-mono">lictory-runner doctor</code> checks the
            setup. The runner appears here as soon as it registers.
          </p>
        </div>
      )}
    </Dialog>
  );
}

function Choice({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  detail,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl p-3 text-left ring-1 outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "bg-primary/6 ring-primary/40"
          : "ring-border hover:bg-muted/50",
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}
