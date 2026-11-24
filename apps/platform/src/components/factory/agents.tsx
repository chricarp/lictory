import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  Bot,
  Copy,
  KeyRound,
  Moon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import type { AgentEntity } from "@lictory/core/factory/entities";
import type { AgentTokenSummary } from "@lictory/core/factory/agents";
import { harnessIds, harnessLabels } from "@lictory/core/factory/protocol";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Dialog } from "@lictory/ui/dialog";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input, inputClass } from "@lictory/ui/input";
import { Segmented, SegmentedItem } from "@lictory/ui/segmented";
import { Switch } from "@lictory/ui/switch";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { harnessLabel } from "@lictory/platform/components/factory/labels";
import {
  FactoryPage,
  useItemKey,
  useSessionStateOf,
} from "@lictory/platform/components/factory/parts";
import { agentActivity } from "@lictory/platform/components/factory/overview-blocks";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import { relativeTime } from "@lictory/core/lib/work-items";
import { MissingState } from "@lictory/ui/status-page";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";
import { Tooltip } from "@lictory/ui/tooltip";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import {
  Actor,
  AgentAvatar,
} from "@lictory/platform/components/identity/actor";
import { StartSessionDialog } from "@lictory/platform/components/factory/start-session";
import { useFactory } from "@lictory/platform/components/factory/store";

// Agents: named members with an accountable owner and a scope. Anyone can
// create agents they own; the owner changes them; the owner or an
// administrator archives them.
export function FactoryAgents() {
  const { userId, isAdmin } = useWorkspace();
  const { agents } = useFactory();
  const [editing, setEditing] = useState<AgentEntity | "new" | null>(null);
  const [tokens, setTokens] = useState<AgentEntity | null>(null);
  const [starting, setStarting] = useState<AgentEntity | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = agents.filter((a) => !a.archivedAt);
  const archived = agents.filter((a) => a.archivedAt);
  const mine = active.filter((a) => a.ownerId === userId);
  const others = active.filter((a) => a.ownerId !== userId);
  const row = (agent: AgentEntity) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      mine={agent.ownerId === userId}
      canArchive={agent.ownerId === userId || isAdmin}
      canStart={
        agent.kind === "runner" &&
        !agent.archivedAt &&
        (agent.ownerId === userId || agent.shared)
      }
      onEdit={() => setEditing(agent)}
      onTokens={() => setTokens(agent)}
      onStart={() => setStarting(agent)}
    />
  );
  const create = (
    <Button onClick={() => setEditing("new")} aria-label="New agent">
      <Plus className="size-3.5" aria-hidden />
      <span className="max-sm:hidden">New agent</span>
    </Button>
  );
  return (
    <FactoryPage
      description="Each agent acts with its owner’s permissions, narrowed by its scope, and is shown as acting via its owner."
      meta={
        agents.length > 0 && (
          <span>
            {active.length} {active.length === 1 ? "agent" : "agents"}
            {mine.length > 0 && ` · ${mine.length} yours`}
          </span>
        )
      }
      actions={create}
    >
      {!agents.length ? (
        <MissingState
          headingLevel={2}
          icon={Bot}
          title="No agents yet"
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-3.5" aria-hidden /> New agent
            </Button>
          }
        >
          A runner agent runs a coding harness (Claude Code, Codex or the
          built-in one) on a runner. An external agent is an MCP client with a
          token of its own. You are accountable for the agents you create.
        </MissingState>
      ) : (
        <>
          <Panel
            title="Yours"
            count={mine.length}
            empty="You own no agent. Create one to start sessions with it."
          >
            {mine.map(row)}
          </Panel>
          <Panel title="Others in the organization" count={others.length}>
            {others.map(row)}
          </Panel>
          {archived.length > 0 && (
            <Panel
              title="Archived"
              count={archived.length}
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "Hide" : "Show"}
                </Button>
              }
              empty={showArchived ? undefined : `${archived.length} archived.`}
            >
              {showArchived && archived.map(row)}
            </Panel>
          )}
        </>
      )}
      {editing && (
        <AgentDialog
          agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {tokens && (
        <TokensDialog agent={tokens} onClose={() => setTokens(null)} />
      )}
      {starting && (
        <StartSessionDialog
          agentId={starting.id}
          onClose={() => setStarting(null)}
        />
      )}
    </FactoryPage>
  );
}

// 32px icon buttons, each named and with a tooltip.
function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <Button
        size="icon"
        variant="ghost"
        aria-label={label}
        onClick={onClick}
        className="size-8"
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function AgentRow({
  agent,
  mine,
  canArchive,
  canStart,
  onEdit,
  onTokens,
  onStart,
}: {
  agent: AgentEntity;
  mine: boolean;
  canArchive: boolean;
  canStart: boolean;
  onEdit: () => void;
  onTokens: () => void;
  onStart: () => void;
}) {
  const { organization, directory } = useWorkspace();
  const { sessions } = useFactory();
  const stateOf = useSessionStateOf();
  const itemKey = useItemKey();
  const activity = useMemo(
    () => agentActivity(agent.id, sessions),
    [agent.id, sessions],
  );
  const projects = agent.projectIds
    ?.map((id) => directory.projects.find((p) => p.id === id)?.key)
    .filter(Boolean);
  const archive = async () => {
    try {
      await callCapability("setAgentArchived", {
        organizationId: organization.id,
        agentId: agent.id,
        archived: !agent.archivedAt,
      });
    } catch (error) {
      toast({
        type: "error",
        title: "The agent was not changed",
        description: (error as Error).message,
      });
    }
  };
  const current = activity.current;
  const key = current ? itemKey(current.workItemId) : undefined;
  const status = agent.archivedAt ? (
    <StatusChip tone="neutral" icon={<Archive />}>
      Archived
    </StatusChip>
  ) : current ? (
    current.status === "running" || current.status === "assigned" ? (
      <StatusChip tone="info" icon={<StatusDot pulse />}>
        {key ? `Working on ${key}` : "Working"}
      </StatusChip>
    ) : (
      <SessionStateChip state={stateOf(current, agent)} />
    )
  ) : (
    <StatusChip tone="neutral" icon={<Moon />}>
      Idle
    </StatusChip>
  );
  return (
    <ListRow
      // Phones keep the name: the time gives way.
      className="max-sm:[&>time]:hidden"
      href={
        current
          ? factoryPaths.session(organization.slug, current.id)
          : undefined
      }
      leading={<AgentAvatar agent={agent} size={24} />}
      title={
        <>
          <span className="font-medium">{agent.name}</span>
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
            @{agent.handle}
          </span>
        </>
      }
      meta={
        <>
          <Actor
            userId={agent.ownerId}
            size={16}
            label="first"
            className="shrink-0"
          />
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {agent.kind === "runner"
              ? harnessLabel(agent.harness)
              : agent.kind === "intelligence"
                ? "Lictory Intelligence"
                : "External (MCP)"}
          </span>
          {agent.model && (
            <span className="truncate font-mono">{agent.model}</span>
          )}
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {agent.access === "read" ? "Read only" : "Read and write"}
          </span>
          <span aria-hidden>·</span>
          <span className="truncate">
            {projects?.length ? projects.join(", ") : "Every project"}
            {agent.shared && " · Shared"}
          </span>
        </>
      }
      chips={status}
      time={
        activity.lastActive
          ? {
              iso: activity.lastActive,
              label: `Active ${relativeTime(activity.lastActive)}`,
            }
          : undefined
      }
      actions={
        <>
          {canStart && (
            <Button size="md" variant="secondary" onClick={onStart}>
              <Play className="size-3.5" aria-hidden /> Start
            </Button>
          )}
          {mine && !agent.archivedAt && (
            <>
              <IconAction label={`Edit ${agent.name}`} onClick={onEdit}>
                <Pencil className="size-3.5" aria-hidden />
              </IconAction>
              {agent.kind !== "intelligence" && (
                <IconAction
                  label={`Access tokens of ${agent.name}`}
                  onClick={onTokens}
                >
                  <KeyRound className="size-3.5" aria-hidden />
                </IconAction>
              )}
            </>
          )}
          {canArchive && (
            <IconAction
              label={
                agent.archivedAt
                  ? `Restore ${agent.name}`
                  : `Archive ${agent.name}`
              }
              onClick={() => void archive()}
            >
              {agent.archivedAt ? (
                <RotateCcw className="size-3.5" aria-hidden />
              ) : (
                <Archive className="size-3.5" aria-hidden />
              )}
            </IconAction>
          )}
        </>
      }
    />
  );
}

const handleOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 30);

function AgentDialog({
  agent,
  onClose,
}: {
  agent: AgentEntity | null;
  onClose: () => void;
}) {
  const { organization, directory } = useWorkspace();
  const { runners } = useFactory();
  const [kind, setKind] = useState<"runner" | "external">(
    agent?.kind === "external" ? "external" : "runner",
  );
  const [name, setName] = useState(agent?.name ?? "");
  const [handle, setHandle] = useState(agent?.handle ?? "");
  const [handleEdited, setHandleEdited] = useState(Boolean(agent));
  const [avatar, setAvatar] = useState(agent?.avatar ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [harness, setHarness] = useState<string>(
    agent?.harness ?? "claude-code",
  );
  const [model, setModel] = useState(agent?.model ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [access, setAccess] = useState<"read" | "write">(
    agent?.access ?? "write",
  );
  const [projectIds, setProjectIds] = useState<string[]>(
    agent?.projectIds ?? [],
  );
  const [shared, setShared] = useState(agent?.shared ?? false);
  const [defaultRunnerId, setDefaultRunnerId] = useState(
    agent?.defaultRunnerId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [agentId] = useState(() => crypto.randomUUID());
  const ids = {
    name: useId(),
    handle: useId(),
    avatar: useId(),
    description: useId(),
    harness: useId(),
    model: useId(),
    instructions: useId(),
    runner: useId(),
    shared: useId(),
  };
  const projects = directory.projects.filter((p) => !p.archivedAt);
  const fields = {
    name,
    handle,
    avatar: avatar.trim() || null,
    description,
    access,
    projectIds: projectIds.length ? projectIds : null,
    shared,
    ...(kind === "runner"
      ? {
          harness,
          model: model.trim() || null,
          instructions,
          defaultRunnerId: defaultRunnerId || null,
        }
      : {}),
  };
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (agent)
        await callCapability("updateAgent", {
          organizationId: organization.id,
          agentId: agent.id,
          ...fields,
        });
      else
        await callCapability("createAgent", {
          organizationId: organization.id,
          agentId,
          kind,
          ...fields,
        });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPending(false);
    }
  };
  const label = "text-[13px] font-medium";
  return (
    <Dialog
      title={agent ? `Edit ${agent.name}` : "New agent"}
      description="You are accountable for what it does. It never has more access than you."
      onClose={onClose}
      onSubmit={() => void submit()}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || !name.trim() || !handle.trim()}
          >
            {pending ? "Saving…" : agent ? "Save" : "Create agent"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!agent && (
          <Segmented
            value={kind}
            onValueChange={(v) => setKind(v)}
            aria-label="Kind of agent"
          >
            <SegmentedItem value="runner">Runs on a runner</SegmentedItem>
            <SegmentedItem value="external">External MCP client</SegmentedItem>
          </Segmented>
        )}
        <div className="grid grid-cols-[4rem_1fr] gap-3">
          <div className="space-y-1.5">
            <label htmlFor={ids.avatar} className={label}>
              Icon
            </label>
            <Input
              id={ids.avatar}
              value={avatar}
              maxLength={4}
              placeholder="🤖"
              onChange={(e) => setAvatar(e.target.value)}
              className="text-center"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={ids.name} className={label}>
              Name
            </label>
            <Input
              id={ids.name}
              data-autofocus
              value={name}
              maxLength={60}
              placeholder="Forge"
              onChange={(e) => {
                setName(e.target.value);
                if (!handleEdited) setHandle(handleOf(e.target.value));
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.handle} className={label}>
            Handle
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">
              @
            </span>
            <Input
              id={ids.handle}
              value={handle}
              maxLength={30}
              className="pl-7 font-mono"
              onChange={(e) => {
                setHandleEdited(true);
                setHandle(e.target.value.toLowerCase());
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            People mention it in channels as @{handle || "handle"}.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={ids.description} className={label}>
            What it is for{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <Input
            id={ids.description}
            value={description}
            maxLength={500}
            placeholder="Implements ready payments stories"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {kind === "runner" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={ids.harness} className={label}>
                  Harness
                </label>
                <DropdownSelect
                  id={ids.harness}
                  value={harness}
                  onValueChange={setHarness}
                  className="w-full"
                >
                  {harnessIds
                    .filter((id) => id !== "opencode" && id !== "gemini")
                    .map((id) => (
                      <DropdownSelectOption key={id} value={id}>
                        {harnessLabels[id]}
                      </DropdownSelectOption>
                    ))}
                </DropdownSelect>
              </div>
              <div className="space-y-1.5">
                <label htmlFor={ids.model} className={label}>
                  Model{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Input
                  id={ids.model}
                  value={model}
                  maxLength={120}
                  disabled={harness === "lictory"}
                  placeholder={
                    harness === "lictory"
                      ? "The organization’s model"
                      : "The harness’s default"
                  }
                  className="font-mono"
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={ids.runner} className={label}>
                Runner
              </label>
              <DropdownSelect
                id={ids.runner}
                value={defaultRunnerId}
                onValueChange={setDefaultRunnerId}
                className="w-full"
                placeholder="Any runner that can run it"
              >
                <DropdownSelectOption value="">
                  Any runner that can run it
                </DropdownSelectOption>
                {runners
                  .filter((r) => !r.revokedAt)
                  .map((runner) => (
                    <DropdownSelectOption key={runner.id} value={runner.id}>
                      {runner.name}
                      {runner.personal ? " (personal)" : ""}
                    </DropdownSelectOption>
                  ))}
              </DropdownSelect>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={ids.instructions} className={label}>
                Instructions{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Textarea
                id={ids.instructions}
                value={instructions}
                rows={3}
                maxLength={8000}
                placeholder="Run the tests before you commit. Keep pull requests small."
                onChange={(e) => setInstructions(e.target.value)}
                className={cn(
                  inputClass,
                  "h-auto resize-y py-2 text-[14px] leading-6",
                )}
              />
            </div>
          </>
        )}
        <fieldset className="space-y-2">
          <legend className={label}>Scope</legend>
          <Segmented
            value={access}
            onValueChange={(v) => setAccess(v)}
            aria-label="Access"
          >
            <SegmentedItem value="write">Read and write</SegmentedItem>
            <SegmentedItem value="read">Read only</SegmentedItem>
          </Segmented>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Projects"
          >
            <ProjectToggle
              label="Every project"
              pressed={!projectIds.length}
              onToggle={() => setProjectIds([])}
            />
            {projects.map((project) => (
              <ProjectToggle
                key={project.id}
                label={project.key}
                title={project.name}
                pressed={projectIds.includes(project.id)}
                onToggle={() =>
                  setProjectIds((current) =>
                    current.includes(project.id)
                      ? current.filter((id) => id !== project.id)
                      : [...current, project.id],
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <label htmlFor={ids.shared} className="flex items-start gap-3">
          <Switch
            id={ids.shared}
            checked={shared}
            onCheckedChange={setShared}
            className="mt-0.5"
          />
          <span className="text-[13px]">
            <span className="font-medium">
              Others may start sessions with it
            </span>
            <span className="block text-xs text-muted-foreground">
              It still acts as you: share only agents whose scope you are
              comfortable lending.
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ProjectToggle({
  label,
  title,
  pressed,
  onToggle,
}: {
  label: string;
  title?: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "h-7 rounded-full px-3 text-xs ring-1 outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ring/60",
        pressed
          ? "bg-primary/10 font-medium text-foreground ring-primary/30"
          : "text-muted-foreground ring-border hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function TokensDialog({
  agent,
  onClose,
}: {
  agent: AgentEntity;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  const [tokens, setTokens] = useState<AgentTokenSummary[] | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("90");
  const endpoint = `${window.location.origin}/api/mcp`;
  const load = useCallback(
    () =>
      callCapability<{ tokens: AgentTokenSummary[] }>("listAgentTokens", {
        organizationId: organization.id,
        agentId: agent.id,
      }).then(
        (r) => setTokens(r.tokens),
        (e: Error) => setError(e.message),
      ),
    [organization.id, agent.id],
  );
  useEffect(() => void load(), [load]);
  const create = async () => {
    setError(null);
    try {
      const result = await callCapability<{ secret: string }>(
        "createAgentToken",
        {
          organizationId: organization.id,
          agentId: agent.id,
          expiresInDays: expiry === "never" ? null : Number(expiry),
        },
      );
      setSecret(result.secret);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const revoke = async (tokenId: string) => {
    try {
      await callCapability("revokeAgentToken", {
        organizationId: organization.id,
        agentId: agent.id,
        tokenId,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const active =
    tokens?.filter(
      (t) =>
        !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt) > new Date()),
    ) ?? [];
  return (
    <Dialog
      title={`Access tokens of ${agent.name}`}
      description={
        <>
          An MCP client using one of these tokens acts as {agent.name}: your
          permissions, narrowed to its scope, in this organization only.
          Endpoint:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {endpoint}
          </code>
        </>
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {secret && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <p className="text-[13px] font-medium">
              Copy this token now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-1.5 font-mono text-xs">
                {secret}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast({ title: "Token copied" });
                }}
              >
                <Copy className="size-3.5" aria-hidden /> Copy
              </Button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <DropdownSelect
            value={expiry}
            onValueChange={setExpiry}
            aria-label="Expires after"
            className="w-36"
          >
            <DropdownSelectOption value="30">30 days</DropdownSelectOption>
            <DropdownSelectOption value="90">90 days</DropdownSelectOption>
            <DropdownSelectOption value="365">1 year</DropdownSelectOption>
            <DropdownSelectOption value="never">No expiry</DropdownSelectOption>
          </DropdownSelect>
          <Button onClick={create}>
            <KeyRound className="size-3.5" aria-hidden /> Create token
          </Button>
        </div>
        {tokens && !active.length && (
          <p className="text-[13px] text-muted-foreground">No active tokens.</p>
        )}
        {active.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {active.map((token) => (
              <li
                key={token.id}
                className="flex items-center gap-3 px-3 py-2 text-[13px]"
              >
                <code className="font-mono text-xs">{token.prefix}…</code>
                <span className="flex-1 text-xs text-muted-foreground">
                  {token.lastUsedAt
                    ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                    : "Never used"}
                  {token.expiresAt
                    ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(token.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
