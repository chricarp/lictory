import { useId, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "@lictory/platform/lib/navigation";
import {
  Archive,
  Bot,
  Check,
  Moon,
  Pencil,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import type { AgentEntity } from "@lictory/core/factory/entities";
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
import { absoluteTime, relativeTime } from "@lictory/core/lib/work-items";
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
import { handOverSecret } from "@lictory/platform/components/factory/agent-connection";
import { useRouter } from "@lictory/platform/lib/navigation";

// Agents: named members with an accountable owner and a scope. Anyone can
// create agents they own; the owner changes them; the owner or an
// administrator archives them.
export function FactoryAgents() {
  const { userId, isAdmin } = useWorkspace();
  const { agents } = useFactory();
  // `?new=1` (the command palette's "New agent") opens the form.
  const search = useSearchParams();
  const [editing, setEditing] = useState<AgentEntity | "new" | null>(() =>
    search.get("new") === "1" ? "new" : null,
  );
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
      onStart={() => setStarting(agent)}
    />
  );
  const create = (
    <Button onClick={() => setEditing("new")}>
      <Plus className="size-3.5" aria-hidden />
      New agent
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
          // The Factory's empty tabs share the Overview's art.
          illustration="planning"
          title="No agents yet"
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-3.5" aria-hidden /> New agent
            </Button>
          }
        >
          A runner agent runs a coding harness (Claude Code, Codex or the
          built-in one) on a runner. An external agent is an MCP client you
          connect with a token of its own, and wake with webhooks, on its page.
          You are accountable for the agents you create.
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
export function IconAction({
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

// Archives an agent, or restores an archived one.
export async function toggleArchived(
  organizationId: string,
  agent: AgentEntity,
) {
  try {
    await callCapability("setAgentArchived", {
      organizationId,
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
}

// What kind of agent, in a word or two.
export function agentKindLabel(agent: AgentEntity) {
  return agent.kind === "runner"
    ? harnessLabel(agent.harness)
    : agent.kind === "intelligence"
      ? "Lictory Intelligence"
      : "External (MCP)";
}

function AgentRow({
  agent,
  mine,
  canArchive,
  canStart,
  onEdit,
  onStart,
}: {
  agent: AgentEntity;
  mine: boolean;
  canArchive: boolean;
  canStart: boolean;
  onEdit: () => void;
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
  const archive = () => toggleArchived(organization.id, agent);
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
  const lastActive = activity.lastActive;
  const actions = (
    <>
      {canStart && (
        <Button size="md" variant="secondary" onClick={onStart}>
          <Play className="size-3.5" aria-hidden /> Start
        </Button>
      )}
      {mine && !agent.archivedAt && (
        <IconAction label={`Edit ${agent.name}`} onClick={onEdit}>
          <Pencil className="size-3.5" aria-hidden />
        </IconAction>
      )}
      {canArchive && (
        <IconAction
          label={
            agent.archivedAt ? `Restore ${agent.name}` : `Archive ${agent.name}`
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
  );
  return (
    <ListRow
      // The agent's page: what it is doing, its sessions and, for its
      // owner, its connection and wake-ups.
      href={factoryPaths.agent(organization.slug, agent.id)}
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
          <span className="flex min-w-0 items-center gap-1">
            <span className="shrink-0">{agentKindLabel(agent)}</span>
            {agent.model && (
              <span className="truncate font-mono">{agent.model}</span>
            )}
          </span>
          <span className="shrink-0">
            {agent.access === "read" ? "Read only" : "Read and write"}
          </span>
          <span className="truncate">
            {projects?.length ? projects.join(", ") : "Every project"}
            {agent.shared && " · Shared"}
          </span>
        </>
      }
      // The row's actions (on hover or focus), then one fixed column for
      // the state and the last activity, so every row's state lines up. On
      // phones the actions stay on the agent's page, so the name keeps the
      // row's width.
      chips={
        <>
          {/* Phones keep the agent's name: its actions are on its page. */}
          <span className="relative z-10 flex items-center gap-1 opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none max-sm:hidden touch:opacity-100">
            {actions}
          </span>
          <span className="flex items-center justify-end gap-3 sm:w-60">
            {status}
            <span className="w-24 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden">
              {lastActive && (
                <time dateTime={lastActive} title={absoluteTime(lastActive)}>
                  Active {relativeTime(lastActive)}
                </time>
              )}
            </span>
          </span>
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

// Creates or edits an agent. A new external agent gets its first token at
// once and opens on its page, where the token is shown once with the setup.
export function AgentDialog({
  agent,
  onClose,
}: {
  agent: AgentEntity | null;
  onClose: () => void;
}) {
  const { organization, directory } = useWorkspace();
  const { runners } = useFactory();
  const router = useRouter();
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
      else {
        await callCapability("createAgent", {
          organizationId: organization.id,
          agentId,
          kind,
          ...fields,
        });
        if (kind === "external") {
          try {
            const token = await callCapability<{ secret: string }>(
              "createAgentToken",
              { organizationId: organization.id, agentId, expiresInDays: 90 },
            );
            handOverSecret(agentId, token.secret);
          } catch (e) {
            toast({
              type: "error",
              title: "The agent has no token yet",
              description: `${(e as Error).message} Create one in its Connection section.`,
            });
          }
          router.push(
            factoryPaths.agent(organization.slug, agentId, "connection"),
          );
        }
      }
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
              placeholder="e.g. Forge"
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
            placeholder="e.g. Implements ready payments stories"
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
                  size="lg"
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
                size="lg"
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
                placeholder="e.g. Run the tests before you commit. Keep pull requests small."
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
      // Chosen looks like the chosen segment of the access control above
      // (a raised chip with the control edge), plus a check: one "selected"
      // in the dialog.
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium focus-ring outline-none",
        pressed
          ? "bg-card text-foreground inset-ring inset-ring-input"
          : "text-muted-foreground inset-ring inset-ring-border hover:bg-muted hover:text-foreground",
      )}
    >
      {pressed && <Check aria-hidden className="size-3" />}
      {label}
    </button>
  );
}
