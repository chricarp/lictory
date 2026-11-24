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
  X,
} from "lucide-react";
import { normalizeChannelName } from "@lictory/core/channels/shared";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { Avatar } from "@lictory/ui/primitives";
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
import { useRouter } from "@lictory/platform/lib/navigation";
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
  "grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

function ChannelIcon({
  channel,
  className,
}: {
  channel: Pick<Channel, "kind">;
  className?: string;
}) {
  const Icon = channel.kind === "private" ? Lock : Hash;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

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
  const { mutateConfirmed, memberName, isAdmin, organization, userId } =
    useWorkspace();
  const router = useRouter();
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
          description: "Both keep their history; nothing more is synced.",
          duration: 5000,
        }),
      )
      .catch(failed("Not unlinked"));
  const join = () =>
    mutateConfirmed({ type: "joinChannel", channelId: channel.id }).catch(
      failed("Not joined"),
    );
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {direct ? (
          <span className="flex -space-x-1">
            {channel.others.slice(0, 3).map((o) =>
              o.kind === "user" ? (
                <Avatar
                  key={o.id}
                  name={memberName(o.id)}
                  userId={o.id}
                  size="md"
                  className="rounded-md ring-2 ring-background"
                />
              ) : (
                <span
                  key={o.id}
                  className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary ring-2 ring-background"
                >
                  <Bot className="size-3.5" aria-hidden />
                </span>
              ),
            )}
          </span>
        ) : (
          <ChannelIcon channel={channel} className="text-muted-foreground" />
        )}
        <h1 className="truncate text-[15px] font-semibold">{label}</h1>
        {channel.archivedAt && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Archived
          </span>
        )}
        {channel.topic && (
          <p
            className="hidden min-w-0 truncate border-l pl-2 text-[13px] text-muted-foreground md:block"
            title={channel.topic}
          >
            {channel.topic}
          </p>
        )}
      </div>
      <SlackSyncStatus channel={channel} />
      {!member && channel.kind === "public" && !channel.archivedAt && (
        <Button size="sm" onClick={join}>
          Join channel
        </Button>
      )}
      <button
        type="button"
        aria-label="Search messages"
        aria-pressed={searchOpen}
        className={cn(iconButton, searchOpen && "bg-muted text-foreground")}
        onClick={onToggleSearch}
      >
        <Search className="size-4" aria-hidden />
      </button>
      <Popover
        width={300}
        align="end"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={`${people.length} ${people.length === 1 ? "member" : "members"}`}
            className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="flex -space-x-1">
              {people.slice(0, 3).map((m) => (
                <Avatar
                  key={m.id}
                  name={memberName(m.userId)}
                  userId={m.userId}
                  size="sm"
                  className="rounded ring-2 ring-background"
                />
              ))}
            </span>
            <span className="tabular-nums">
              {people.length + agents.length}
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
                className={iconButton}
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
                <Pencil className="size-3.5 text-muted-foreground" /> Edit name
                and topic
              </MenuItem>
            )}
            {!channel.archivedAt &&
              (channel.externalSource === "slack" ? (
                <MenuItem onSelect={() => void unlink()}>
                  <SlackMark className="size-3.5 text-muted-foreground" />{" "}
                  Unlink from Slack
                </MenuItem>
              ) : (
                !channel.externalSource && (
                  <MenuItem onSelect={() => setLinking(true)}>
                    <SlackMark className="size-3.5 text-muted-foreground" />{" "}
                    Link to Slack channel…
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
                <Archive className="size-3.5 text-muted-foreground" /> Archive
                channel
              </MenuItem>
            )}
            {member && (
              <>
                <MenuSeparator />
                <MenuItem onSelect={() => void leave()}>
                  <LogOut className="size-3.5 text-muted-foreground" /> Leave
                  channel
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      )}
      {editing && (
        <EditChannelDialog
          channel={channel}
          onClose={() => setEditing(false)}
        />
      )}
      {linking && (
        <LinkSlackDialog channel={channel} onClose={() => setLinking(false)} />
      )}
    </header>
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
  const add = (id: string) =>
    mutateConfirmed({
      type: "addChannelMembers",
      channelId: channel.id,
      userIds: [id],
    }).catch(failed("Not added"));
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
      <p className="px-3 pt-2 pb-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        Members
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {people.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px]"
          >
            <Avatar name={memberName(m.userId)} userId={m.userId} size="md" />
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
                className="grid size-6 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
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
            <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary">
              <Bot className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate">Agent</span>
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
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
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
