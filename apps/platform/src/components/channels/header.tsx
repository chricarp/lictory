import { useId, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  BellRing,
  Bot,
  Hash,
  LogOut,
  Lock,
  MoreHorizontal,
  Pencil,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { normalizeChannelName } from "@lictory/core/channels/shared";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { StatusChip } from "@lictory/ui/status-chip";
import { Tooltip } from "@lictory/ui/tooltip";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover } from "@lictory/ui/popover";
import { toast } from "@lictory/ui/toast";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@lictory/ui/menu";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { Dialog, Field } from "@lictory/platform/components/spaces/dialog";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useFactory } from "@lictory/platform/components/factory/store";
import { useRouter } from "@lictory/platform/lib/navigation";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import {
  Actor,
  AgentAvatar,
  Facepile,
  PersonAvatar,
  type Person,
} from "@lictory/platform/components/identity/actor";
import type {
  Channel,
  MemberRow,
} from "@lictory/platform/components/channels/data";
import {
  LinkSlackDialog,
  SlackMark,
  SlackSyncStatus,
} from "@lictory/platform/components/channels/slack";
import { callCapability } from "@lictory/core/capabilities/client";

const iconButton =
  "grid size-8 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground";

const failed = (title: string) => (e: unknown) =>
  toast({
    title,
    type: "error",
    description: e instanceof Error ? e.message : undefined,
    duration: 8000,
  });

export function ChannelHeader({
  channel,
  label,
  members,
  onToggleSearch,
  searchOpen,
}: {
  channel: Channel;
  label: string;
  members: readonly MemberRow[];
  onToggleSearch: () => void;
  searchOpen: boolean;
}) {
  const {
    mutateConfirmed,
    memberName,
    isAdmin,
    organization,
    userId,
    directory,
  } = useWorkspace();
  const factory = useFactory();
  const router = useRouter();
  const person = (id: string | null): Person => ({
    id: id ?? "unknown",
    name: memberName(id),
    image: directory.members.find((m) => m.id === id)?.image ?? null,
  });
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const member = channel.member;
  const direct = channel.kind === "direct";
  const canManage = !direct && (Boolean(member) || isAdmin);
  const people = members.filter((m) => m.memberKind === "user");
  const agents = members.filter((m) => m.memberKind === "agent");
  const level = member?.notificationLevel ?? "mentions";
  const setLevel = (next: string) =>
    mutateConfirmed({
      type: "setChannelNotificationLevel",
      channelId: channel.id,
      level: next as "all" | "mentions" | "none",
    }).catch(failed("Notifications not changed"));
  const archive = (archived: boolean) =>
    mutateConfirmed({
      type: "setChannelArchived",
      channelId: channel.id,
      archived,
    }).catch(failed(archived ? "Not archived" : "Not restored"));
  const leave = () =>
    mutateConfirmed({ type: "leaveChannel", channelId: channel.id })
      .then(() => {
        if (channel.kind === "private")
          router.push(paths.channels(organization.slug));
      })
      .catch(failed("You did not leave the channel"));
  const unlink = () =>
    callCapability("unlinkSlackChannel", {
      organizationId: organization.id,
      channelId: channel.id,
    })
      .then(() =>
        toast({
          title: "Unlinked from Slack",
          duration: 5000,
        }),
      )
      .catch(failed("Not unlinked"));
  const join = () =>
    mutateConfirmed({ type: "joinChannel", channelId: channel.id }).catch(
      failed("Not joined"),
    );
  const facepile = [
    ...people.map((m) => person(m.userId)),
    ...agents.flatMap((m) => {
      const agent = m.agentId ? factory.agentById.get(m.agentId) : undefined;
      return agent ? [{ ...agent, agent: true as const }] : [];
    }),
  ];
  const memberCount = people.length + agents.length;
  return (
    <>
      <PageHeader
        title={label}
        // The channel searches its own messages; on phones its name keeps
        // at least twelve characters before the actions crowd it. The
        // shell's "+" (a new work item) stays in the navigation drawer, so
        // the bar fits at 320px. Wider, the name is the anchor: the topic
        // beside it gives way first. Its cap is a share of the window, not
        // of the title group (which is only as wide as its content, so a
        // percentage of it cut "#partner-launch" to "partner…").
        ownSearch
        ownCreate
        className="sm:[&_h1]:max-w-[40vw] sm:[&_h1]:shrink-0 max-sm:[&>div:has(>h1)]:min-w-[12ch]"
        icon={
          direct ? (
            channel.others[0]?.kind === "user" ? (
              <PersonAvatar person={person(channel.others[0].id)} size={16} />
            ) : (
              <Bot />
            )
          ) : channel.kind === "private" ? (
            <Lock />
          ) : (
            <Hash />
          )
        }
        meta={
          (channel.archivedAt ?? channel.topic) ? (
            <>
              {channel.archivedAt && (
                <StatusChip tone="neutral" icon={<Archive />}>
                  Archived
                </StatusChip>
              )}
              {channel.topic && (
                <span className="min-w-0 truncate" title={channel.topic}>
                  {channel.topic}
                </span>
              )}
            </>
          ) : undefined
        }
        actions={
          <>
            <SlackSyncStatus channel={channel} />
            {!member && channel.kind === "public" && !channel.archivedAt && (
              <Button onClick={join}>Join channel</Button>
            )}
            <Tooltip label="Search messages">
              <button
                type="button"
                aria-label="Search messages"
                aria-pressed={searchOpen}
                className={cn(
                  iconButton,
                  searchOpen && "bg-muted text-foreground",
                )}
                onClick={onToggleSearch}
              >
                <Search className="size-4" aria-hidden />
              </button>
            </Tooltip>
            <Popover
              width={300}
              align="end"
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
                >
                  {/* A picture of who is here. The button is named by what
                      it shows in words, the count ("4 members"), so a voice
                      user can say the number they see; the faces are not
                      part of that name and never show a "+N" of their own. */}
                  <span aria-hidden className="contents">
                    <Facepile
                      people={facepile.slice(0, 3)}
                      max={3}
                      size={20}
                      className="max-sm:hidden"
                    />
                  </span>
                  <Users className="size-4 sm:hidden" aria-hidden />
                  <span className="tabular-nums">
                    {memberCount}
                    <span className="sr-only">
                      {memberCount === 1 ? " member" : " members"}
                    </span>
                  </span>
                </button>
              )}
            >
              <MembersPanel
                channel={channel}
                people={people}
                agents={agents}
                canManage={canManage && !channel.archivedAt}
                userId={userId}
              />
            </Popover>
            {member && (
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Notifications: ${levelLabel(level)}`}
                      className={cn(iconButton, "max-sm:hidden")}
                    />
                  }
                >
                  {level === "none" ? (
                    <BellOff className="size-4" aria-hidden />
                  ) : level === "all" ? (
                    <BellRing className="size-4" aria-hidden />
                  ) : (
                    <Bell className="size-4" aria-hidden />
                  )}
                </MenuTrigger>
                <MenuContent align="end" width={260}>
                  <MenuLabel>Notify me about</MenuLabel>
                  <MenuRadioGroup
                    value={level}
                    onValueChange={(v) => void setLevel(String(v))}
                  >
                    <MenuRadioItem value="all">All new messages</MenuRadioItem>
                    <MenuRadioItem value="mentions">
                      {direct ? "Mentions only" : "Mentions and my threads"}
                    </MenuRadioItem>
                    <MenuRadioItem value="none">Nothing (mute)</MenuRadioItem>
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
            )}
            {canManage && (
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Channel actions"
                      className={iconButton}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </MenuTrigger>
                <MenuContent align="end" width={220}>
                  {!channel.archivedAt && (
                    <MenuItem onSelect={() => setEditing(true)}>
                      <Pencil className="size-3.5 text-muted-foreground" /> Edit
                      name and topic
                    </MenuItem>
                  )}
                  {!channel.archivedAt &&
                    (channel.externalSource === "slack" ? (
                      <MenuItem onSelect={() => void unlink()}>
                        <SlackMark className="size-3.5" /> Unlink from Slack
                      </MenuItem>
                    ) : (
                      !channel.externalSource && (
                        <MenuItem onSelect={() => setLinking(true)}>
                          <SlackMark className="size-3.5" /> Link to Slack
                          channel…
                        </MenuItem>
                      )
                    ))}
                  {channel.archivedAt ? (
                    <MenuItem onSelect={() => void archive(false)}>
                      <ArchiveRestore className="size-3.5 text-muted-foreground" />{" "}
                      Restore channel
                    </MenuItem>
                  ) : (
                    <MenuItem onSelect={() => void archive(true)}>
                      <Archive className="size-3.5 text-muted-foreground" />{" "}
                      Archive channel
                    </MenuItem>
                  )}
                  {member && (
                    <>
                      <MenuSeparator />
                      <MenuItem onSelect={() => void leave()}>
                        <LogOut className="size-3.5 text-muted-foreground" />{" "}
                        Leave channel
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            )}
          </>
        }
      />
      {editing && (
        <EditChannelDialog
          channel={channel}
          onClose={() => setEditing(false)}
        />
      )}
      {linking && (
        <LinkSlackDialog channel={channel} onClose={() => setLinking(false)} />
      )}
    </>
  );
}

function levelLabel(level: string) {
  return level === "all"
    ? "all messages"
    : level === "none"
      ? "muted"
      : "mentions";
}

function MembersPanel({
  channel,
  people,
  agents,
  canManage,
  userId,
}: {
  channel: Channel;
  people: readonly MemberRow[];
  agents: readonly MemberRow[];
  canManage: boolean;
  userId: string;
}) {
  const { mutateConfirmed, memberName } = useWorkspace();
  const factory = useFactory();
  const add = (id: string) =>
    mutateConfirmed({
      type: "addChannelMembers",
      channelId: channel.id,
      userIds: [id],
    }).catch(failed("Not added"));
  const addAgent = (agentId: string) =>
    mutateConfirmed({
      type: "addChannelMembers",
      channelId: channel.id,
      agentIds: [agentId],
    }).catch(failed("Not added"));
  const memberAgents = new Set(agents.map((m) => m.agentId));
  const addable = factory.agents.filter(
    (a) =>
      !a.archivedAt && a.kind !== "intelligence" && !memberAgents.has(a.id),
  );
  const agentLabel = (id: string | null) => {
    const agent = id ? factory.agentById.get(id) : undefined;
    return agent ? `${agent.name} (@${agent.handle})` : "Agent";
  };
  const remove = (member: MemberRow) =>
    mutateConfirmed({
      type: "removeChannelMember",
      channelId: channel.id,
      ...(member.userId
        ? { userId: member.userId }
        : { agentId: member.agentId! }),
    }).catch(failed("Not removed"));
  return (
    <div className="flex max-h-96 flex-col">
      <p className="px-3 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">
        Members
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {people.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]"
          >
            <Actor userId={m.userId} size={24} label="none" />
            <span className="min-w-0 flex-1 truncate">
              {memberName(m.userId)}
              {m.userId === userId && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </span>
            {canManage && m.userId !== userId && (
              <button
                type="button"
                aria-label={`Remove ${memberName(m.userId)}`}
                className="grid size-7 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
                onClick={() => void remove(m)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {agents.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]"
          >
            {m.agentId && factory.agentById.get(m.agentId) ? (
              <AgentAvatar
                agent={factory.agentById.get(m.agentId)!}
                size={24}
              />
            ) : (
              <Bot className="size-4 text-muted-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">
              {agentLabel(m.agentId)}
            </span>
            {canManage && (
              <button
                type="button"
                aria-label={`Remove ${agentLabel(m.agentId)}`}
                className="grid size-7 place-items-center rounded-md text-muted-foreground focus-ring outline-none hover:bg-muted hover:text-foreground"
                onClick={() => void remove(m)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="border-t p-1">
          <Popover
            width={280}
            align="start"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] focus-ring-inset outline-none hover:bg-muted"
              >
                <UserPlus
                  className="size-3.5 text-muted-foreground"
                  aria-hidden
                />
                Add people
              </button>
            )}
          >
            <PeoplePicker
              title="Add to channel"
              excludeIds={people.flatMap((m) => (m.userId ? [m.userId] : []))}
              memberValue={(person) => person.id}
              onSelect={(id) => void add(id)}
            />
          </Popover>
          {addable.length > 0 && (
            <Menu>
              <MenuTrigger
                render={
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] focus-ring-inset outline-none hover:bg-muted"
                  />
                }
              >
                <Bot className="size-3.5 text-muted-foreground" aria-hidden />
                Add an agent
              </MenuTrigger>
              <MenuContent align="start" width={260}>
                {addable.map((a) => (
                  <MenuItem key={a.id} onSelect={() => void addAgent(a.id)}>
                    <AgentAvatar agent={a} size={20} /> {a.name}
                    <span className="ml-auto text-[12px] text-muted-foreground">
                      @{a.handle}
                    </span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>
      )}
    </div>
  );
}

function EditChannelDialog({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const { mutateConfirmed } = useWorkspace();
  const ids = { name: useId(), topic: useId() };
  const [name, setName] = useState(channel.name ?? "");
  const [topic, setTopic] = useState(channel.topic);
  const [error, setError] = useState("");
  const normalized = normalizeChannelName(name);
  const save = () => {
    setError("");
    mutateConfirmed({
      type: "updateChannel",
      channelId: channel.id,
      ...(normalized && normalized !== channel.name
        ? { name: normalized }
        : {}),
      ...(topic !== channel.topic ? { topic: topic.trim() } : {}),
    })
      .then(onClose)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Not saved."),
      );
  };
  return (
    <Dialog
      title="Edit channel"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!normalized}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Name"
          htmlFor={ids.name}
          hint={normalized !== name ? `Will be #${normalized}` : undefined}
        >
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-autofocus
          />
        </Field>
        <Field label="Topic" htmlFor={ids.topic} optional>
          <Input
            id={ids.topic}
            value={topic}
            maxLength={250}
            onChange={(e) => setTopic(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
