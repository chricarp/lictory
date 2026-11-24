import { useState } from "react";
import { Box, Copy, Laptop, Plus, Server, Trash2 } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  runnerOnline,
  type RunnerEntity,
} from "@lictory/core/factory/entities";
import { harnessLabels, type HarnessId } from "@lictory/core/factory/protocol";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Dialog } from "@lictory/ui/dialog";
import { Badge, EmptyState } from "@lictory/ui/primitives";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { osLabel } from "@lictory/platform/components/factory/labels";
import {
  FactoryPage,
  Section,
} from "@lictory/platform/components/factory/parts";
import { useFactory } from "@lictory/platform/components/factory/store";

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
  const list = (shown: RunnerEntity[]) => (
    <ul className="divide-y divide-border/60 rounded-xl bg-card shadow-(--shadow-border)">
      {shown.map((runner) => (
        <RunnerRow
          key={runner.id}
          runner={runner}
          sessions={busy(runner)}
          owner={runner.ownerId ? memberName(runner.ownerId) : null}
          canRevoke={
            runner.ownerId ? runner.ownerId === userId || isAdmin : isAdmin
          }
        />
      ))}
    </ul>
  );
  return (
    <FactoryPage
      title="Runners"
      description="Machines you control that run agent sessions, each in its own git worktree. Organization runners run anyone’s agents; personal runners only their owner’s."
      actions={
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden /> Add runner
        </Button>
      }
    >
      {!active.length ? (
        <EmptyState
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
        </EmptyState>
      ) : (
        <>
          <Section title="Organization runners" count={organization.length}>
            {organization.length ? (
              list(organization)
            ) : (
              <p className="px-3 text-[13px] text-muted-foreground">
                None. An administrator adds runners everyone’s agents can use.
              </p>
            )}
          </Section>
          {personal.length > 0 && (
            <Section title="Personal runners" count={personal.length}>
              {list(personal)}
            </Section>
          )}
        </>
      )}
      {adding && <AddRunnerDialog onClose={() => setAdding(false)} />}
    </FactoryPage>
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
        title: "The runner was not revoked",
        description: (error as Error).message,
      });
    }
  };
  const Icon = runner.personal ? Laptop : Server;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="relative grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        <span
          aria-hidden
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {runner.name}
          </span>
          <Badge tone={online ? "good" : "neutral"}>
            {online ? "Online" : "Offline"}
          </Badge>
          {runner.isolation === "container" && (
            <Badge tone="info">
              <Box className="size-3" aria-hidden /> Containers
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {owner && <span>{owner}’s</span>}
          <span>
            {osLabel(runner.os)} {runner.arch}
          </span>
          <span>·</span>
          <span>
            {runner.harnesses.length
              ? runner.harnesses
                  .map((h) => harnessLabels[h.id as HarnessId] ?? h.id)
                  .join(", ")
              : "No harness found"}
          </span>
          <span>·</span>
          <span className="tabular-nums">
            {sessions} of {runner.maxSessions} sessions
          </span>
          <span>·</span>
          <span>
            {runner.lastSeenAt
              ? `Seen ${relativeTime(runner.lastSeenAt)}`
              : "Never connected"}
          </span>
          {runner.version && (
            <span className="font-mono">v{runner.version}</span>
          )}
        </div>
      </div>
      {canRevoke &&
        (confirming ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Its sessions return to the queue.
            </span>
            <Button size="sm" variant="danger" onClick={revoke}>
              Revoke
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
          </div>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Revoke ${runner.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        ))}
    </li>
  );
}

const RELEASES = "https://github.com/chricarp/lictory/releases/latest/download";

// The commands that install and register a runner on each system.
function installCommands(server: string, token: string) {
  const register = (binary: string) =>
    `${binary} register --url ${server} --token ${token}`;
  return {
    linux: [
      `curl -fsSLo lictory-runner ${RELEASES}/lictory-runner-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')`,
      "chmod +x lictory-runner && sudo mv lictory-runner /usr/local/bin/",
      register("lictory-runner"),
      "lictory-runner install-service --enable",
    ].join("\n"),
    macos: [
      `curl -fsSLo lictory-runner ${RELEASES}/lictory-runner-darwin-$(uname -m | sed 's/x86_64/x64/')`,
      "chmod +x lictory-runner && sudo mv lictory-runner /usr/local/bin/",
      register("lictory-runner"),
      "lictory-runner install-service --enable",
    ].join("\n"),
    windows: [
      `Invoke-WebRequest -Uri ${RELEASES}/lictory-runner-windows-x64.exe -OutFile lictory-runner.exe`,
      register(".\\lictory-runner.exe"),
      ".\\lictory-runner.exe install-service",
    ].join("\n"),
  };
}

function AddRunnerDialog({ onClose }: { onClose: () => void }) {
  const { organization, isAdmin } = useWorkspace();
  const [personal, setPersonal] = useState(!isAdmin);
  const [token, setToken] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);
  const [system, setSystem] = useState<"linux" | "macos" | "windows">(() =>
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
    ? installCommands(window.location.origin, token.token)[system]
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
