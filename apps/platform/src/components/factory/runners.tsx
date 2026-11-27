import { useState, type ReactNode } from "react";
import { useSearchParams } from "@lictory/platform/lib/navigation";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Box,
  ChevronRight,
  CircleDashed,
  CircleOff,
  Laptop,
  Plus,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  runnerOnline,
  takesSlot,
  type RunnerEntity,
  type SessionEntity,
} from "@lictory/core/factory/entities";
import { harnessLabels, type HarnessId } from "@lictory/core/factory/protocol";
import { APP_VERSION } from "@lictory/core/lib/app-version";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { CommandBlock } from "@lictory/ui/command-block";
import { Dialog } from "@lictory/ui/dialog";
import { MissingState } from "@lictory/ui/status-page";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { toast } from "@lictory/ui/toast";
import { Tooltip } from "@lictory/ui/tooltip";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { osLabel } from "@lictory/platform/components/factory/labels";
import {
  FactoryPage,
  SessionRow,
} from "@lictory/platform/components/factory/parts";
import { runnerVersionSkew } from "@lictory/platform/components/factory/runner-version";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { MetaPart } from "@lictory/platform/components/shell/meta-line";
import { useFactory } from "@lictory/platform/components/factory/store";
import {
  expiresIn,
  runnerFromSourceCommand,
  runnerInstallCommand,
  type RunnerSystem,
} from "@lictory/platform/components/factory/runner-install";

// Runners: machines the team controls that execute agent sessions. They
// connect out to Lictory, so they need no open port.
export function FactoryRunners() {
  const { userId, isAdmin, memberName } = useWorkspace();
  const { runners, sessions } = useFactory();
  // `?add=1` (the command palette's "Add runner") opens the dialog.
  const search = useSearchParams();
  const [adding, setAdding] = useState(() => search.get("add") === "1");
  const active = runners.filter((r) => !r.revokedAt);
  // The server's rule: a session waiting on a person takes no slot.
  const busy = (runner: RunnerEntity) =>
    sessions.filter((s) => s.runnerId === runner.id && takesSlot(s.status))
      .length;
  const waiting = (runner: RunnerEntity) =>
    sessions.filter((s) => s.runnerId === runner.id && s.status === "waiting")
      .length;
  // Runners on an older release than the server: said once, above the
  // lists, and on each row.
  const behind = active.filter(
    (r) => runnerVersionSkew(r.version, APP_VERSION) === "behind",
  );
  const organization = active.filter((r) => !r.personal);
  const personal = active.filter((r) => r.personal);
  const online = active.filter((r) => runnerOnline(r)).length;
  const row = (runner: RunnerEntity) => (
    <RunnerRow
      key={runner.id}
      runner={runner}
      sessions={busy(runner)}
      waiting={waiting(runner)}
      recent={sessions
        .filter((s) => s.runnerId === runner.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, RECENT_SESSIONS)}
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
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden />
          Add runner
        </Button>
      }
    >
      {!active.length ? (
        <MissingState
          headingLevel={2}
          icon={Server}
          // The Factory's empty tabs share the Overview's art.
          illustration="planning"
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
          {behind.length > 0 && (
            <div
              role="status"
              data-runners-behind
              className="flex items-start gap-3 rounded-xl bg-warning/8 px-4 py-3 text-[13px] ring-1 ring-warning/25 ring-inset"
            >
              <TriangleAlert
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]"
              />
              <span>
                {behind.length === 1
                  ? `${behind[0]!.name} runs`
                  : `${behind.length} runners run`}{" "}
                an older release than this server (v{APP_VERSION}). Update{" "}
                {behind.length === 1 ? "it" : "them"}: rerun the installer on
                the machine, then restart its service.
              </span>
            </div>
          )}
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
    // A fixed width, so every row's meter and state line up.
    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums sm:w-36">
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

// How many of a runner's sessions its detail lists.
const RECENT_SESSIONS = 5;

function RunnerRow({
  runner,
  sessions,
  waiting,
  recent,
  owner,
  canRevoke,
}: {
  runner: RunnerEntity;
  // Sessions taking a slot, and sessions waiting on a person (no slot).
  sessions: number;
  waiting: number;
  // Its latest sessions, newest first.
  recent: SessionEntity[];
  owner: string | null;
  canRevoke: boolean;
}) {
  const { organization } = useWorkspace();
  const { agentById } = useFactory();
  const [open, setOpen] = useState(false);
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
  // Registering is the runner's first contact; a runner that has not
  // connected since was registered but never started.
  const started = runner.lastSeenAt !== runner.registeredAt;
  const behind = runnerVersionSkew(runner.version, APP_VERSION) === "behind";
  const harnesses = runner.harnesses.length
    ? runner.harnesses
        .map((h) => harnessLabels[h.id as HarnessId] ?? h.id)
        .join(", ")
    : "No harness found";
  return (
    <>
      <ListRow
        // Phones keep the name: the time gives way (the detail has it). The
        // time has a fixed width so the chips line up from row to row.
        className="max-sm:[&>time]:hidden sm:[&>time]:w-28 sm:[&>time]:text-right"
        onClick={() => setOpen((o) => !o)}
        expanded={open}
        leading={<Icon aria-hidden className="text-muted-foreground" />}
        title={<span className="font-medium">{runner.name}</span>}
        meta={
          <>
            {owner && <span className="shrink-0">{owner}’s</span>}
            <MetaPart className="shrink-0 max-sm:hidden">
              {osLabel(runner.os)} {runner.arch}
            </MetaPart>
            <span className="truncate">{harnesses}</span>
            {runner.version && (
              <span
                className={cn(
                  "shrink-0 font-mono",
                  behind &&
                    "text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]",
                )}
              >
                v{runner.version}
              </span>
            )}
          </>
        }
        chips={
          <>
            <Capacity used={sessions} max={runner.maxSessions} />
            {runner.isolation === "container" && (
              <StatusChip
                tone="neutral"
                icon={<Box />}
                className="max-sm:hidden"
              >
                Containers
              </StatusChip>
            )}
            {behind && (
              <StatusChip
                tone="attention"
                icon={<TriangleAlert />}
                title={`It runs v${runner.version}; the server runs v${APP_VERSION}.`}
              >
                Update
              </StatusChip>
            )}
            <span className="flex sm:w-24">
              {/* Three situations, three looks: connected, lost (its
                  sessions wait, someone should check the machine) and
                  never connected yet. */}
              <StatusChip
                tone={online ? "success" : started ? "attention" : "neutral"}
                icon={
                  online ? (
                    <StatusDot />
                  ) : started ? (
                    <CircleOff />
                  ) : (
                    <CircleDashed />
                  )
                }
                title={
                  !started
                    ? "Registered, but it has not connected since. Run lictory-runner start (or its service) on the machine."
                    : runner.lastSeenAt
                      ? `Last seen ${new Date(runner.lastSeenAt).toLocaleString()}`
                      : "It has never connected."
                }
              >
                {online ? "Online" : started ? "Offline" : "Not started"}
              </StatusChip>
            </span>
          </>
        }
        time={
          !started
            ? {
                iso: runner.registeredAt,
                label: `Registered ${relativeTime(runner.registeredAt)}`,
              }
            : runner.lastSeenAt
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
            <Tooltip label="Remove runner…">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 max-sm:hidden"
                onClick={() => setConfirming(true)}
                aria-label={`Remove ${runner.name}…`}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </Tooltip>
          ) : undefined
        }
      />
      {open && (
        <li data-runner-detail className="bg-muted/30 px-3.5 py-3 sm:pl-[46px]">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            <Fact label="State">
              {online
                ? `Online, seen ${relativeTime(runner.lastSeenAt!)}`
                : !started
                  ? "Registered, but it has not connected since. Run lictory-runner start (or its service) on the machine."
                  : runner.lastSeenAt
                    ? `Offline since ${new Date(runner.lastSeenAt).toLocaleString()}. Check the machine and its lictory-runner service; lictory-runner doctor checks the setup.`
                    : "It has never connected."}
            </Fact>
            {/* What the runner last reported failing (the server out of
                reach, asking for work refused), so an offline runner can be
                told apart from a machine that is off. Its time says how old
                it is: a runner reports it once it reaches the server again. */}
            {runner.lastError && (
              <Fact label="Last problem">
                <span className="break-words">{runner.lastError.message}</span>{" "}
                <time
                  dateTime={runner.lastError.at}
                  title={new Date(runner.lastError.at).toLocaleString()}
                  className="text-muted-foreground"
                >
                  ({relativeTime(runner.lastError.at)})
                </time>
              </Fact>
            )}
            <Fact label="Machine">
              {[runner.hostname, `${osLabel(runner.os)} ${runner.arch}`]
                .filter(Boolean)
                .join(" · ")}
            </Fact>
            <Fact label="Version">
              <span className="font-mono">
                {runner.version ? `v${runner.version}` : "Unknown"}
              </span>
              {behind
                ? `: older than this server (v${APP_VERSION}). Rerun the installer on the machine, then restart its service.`
                : ""}
            </Fact>
            <Fact label="Harnesses">
              {runner.harnesses.length
                ? runner.harnesses
                    .map(
                      (h) =>
                        `${harnessLabels[h.id as HarnessId] ?? h.id}${h.version ? ` ${h.version}` : ""}`,
                    )
                    .join(", ")
                : "None found on the machine: install Claude Code or Codex there, then restart the runner."}
            </Fact>
            <Fact label="Isolation">
              {runner.isolation === "container"
                ? "Each session runs in a container, in its own git worktree."
                : "Each session runs on the machine as the runner’s account, in its own git worktree."}
            </Fact>
            <Fact label="Labels">
              {runner.labels.length ? (
                <span className="flex flex-wrap gap-1">
                  {runner.labels.map((label) => (
                    <span
                      key={label}
                      className="rounded-md bg-muted px-1.5 font-mono text-[11px] leading-[18px]"
                    >
                      {label}
                    </span>
                  ))}
                </span>
              ) : (
                "None"
              )}
            </Fact>
            <Fact label="Capacity">
              {sessions} of {runner.maxSessions} sessions running
              {waiting > 0 &&
                ` · ${waiting} waiting on a person (they take no slot)`}
            </Fact>
            <Fact label="Registered">
              {new Date(runner.registeredAt).toLocaleString()}
              {owner ? ` · personal runner of ${owner}` : ""}
            </Fact>
          </dl>
          <p className="mt-3 mb-1 text-xs font-semibold text-muted-foreground">
            {recent.length ? "Latest sessions" : "No sessions on it yet."}
          </p>
          {recent.length > 0 && (
            <ul className="divide-y divide-border/70 rounded-lg bg-card shadow-(--shadow-border)">
              {recent.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  agent={agentById.get(session.agentId)}
                  log
                />
              ))}
            </ul>
          )}
          {canRevoke && !confirming && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" aria-hidden /> Remove runner…
            </Button>
          )}
        </li>
      )}
      {confirming && (
        <li
          role="alert"
          className="flex flex-wrap items-center gap-2 bg-destructive/5 px-3.5 py-2.5 text-[13px]"
        >
          <span className="mr-auto">
            Remove <span className="font-medium">{runner.name}</span>? Its
            credential stops working and its sessions return to the queue. The
            organization’s audit log keeps who removed it.
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
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
          <CommandBlock
            label="Install and register commands"
            copyLabel="Copy the commands"
          >
            {commands}
          </CommandBlock>
          <p className="text-xs text-muted-foreground">
            The token works once and expires{" "}
            <time dateTime={token.expiresAt}>{expiresIn(token.expiresAt)}</time>
            . The installer checks the download against the release&apos;s
            checksums, registers the runner and keeps it running as a service.
            Install Claude Code or Codex on the machine for those agents;{" "}
            <code className="font-mono">lictory-runner doctor</code> checks the
            setup. The runner appears here as soon as it registers.
          </p>
          {/* A release published before runner downloads existed has no
              installer, so curl answers 404: the same runner from source. */}
          <Collapsible className="text-xs text-muted-foreground">
            <CollapsibleTrigger className="group inline-flex cursor-pointer items-center gap-1 font-medium text-foreground select-none hover:underline">
              <ChevronRight
                aria-hidden
                className="size-3 transition-transform duration-150 group-data-open:rotate-90"
              />
              The download answers 404?
            </CollapsibleTrigger>
            <CollapsiblePanel className="mt-2 space-y-2">
              <p>
                {APP_VERSION && /^\d+\.\d+\.\d+/.test(APP_VERSION)
                  ? `This server's release (${APP_VERSION}) has no runner files yet.`
                  : "The newest release has no runner files yet."}{" "}
                Build the same runner from source with{" "}
                <a
                  href="https://bun.sh"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Bun
                </a>{" "}
                and git, then register it with the same token:
              </p>
              <CommandBlock
                label="Build from source and register"
                copyLabel="Copy the build commands"
              >
                {runnerFromSourceCommand(
                  system,
                  window.location.origin,
                  token.token,
                  APP_VERSION,
                )}
              </CommandBlock>
            </CollapsiblePanel>
          </Collapsible>
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
        // Selected as every choice card: a 2px outline in the text colour.
        selected ? "ring-2 ring-foreground" : "ring-border hover:bg-muted/50",
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
