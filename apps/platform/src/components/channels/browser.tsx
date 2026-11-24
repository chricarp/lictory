import { useId, useMemo, useState } from "react";
import { Hash, Lock, MessageSquarePlus, Plus, Search } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { normalizeChannelName } from "@lictory/core/channels/shared";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { Avatar, EmptyState } from "@lictory/ui/primitives";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Checkbox } from "@lictory/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lictory/ui/select";
import { Popover } from "@lictory/ui/popover";
import { toast } from "@lictory/ui/toast";
import {
  Dialog,
  Field,
  RadioCards,
} from "@lictory/platform/components/spaces/dialog";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { useChannels } from "@lictory/platform/components/channels/store";
import {
  channelLabel,
  type Channel,
} from "@lictory/platform/components/channels/data";
import {
  SearchPanel,
  type SearchResult,
} from "@lictory/platform/components/channels/side-panels";

// /{org}/channels: every channel I can read, joined or not, with a filter,
// and the ways to start a conversation (a new channel, a direct message).

export function ChannelBrowser() {
  const { organization, memberName, mutateConfirmed } = useWorkspace();
  const router = useRouter();
  const { list, loaded } = useChannels();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const channels = useMemo(() => {
    const q = normalizeChannelName(query);
    return list
      .filter((c) => c.kind !== "direct")
      .filter((c) => showArchived || !c.archivedAt)
      .filter(
        (c) =>
          !q ||
          (c.name ?? "").includes(q) ||
          c.topic.toLowerCase().includes(query.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.member)) - Number(Boolean(a.member)) ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      );
  }, [list, query, showArchived]);
  const direct = list
    .filter((c) => c.kind === "direct" && c.lastSequence > 0)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, 20);
  const open = (channel: Channel) =>
    router.push(paths.channel(organization.slug, channel.id));
  const join = (channel: Channel) =>
    mutateConfirmed({ type: "joinChannel", channelId: channel.id })
      .then(() => open(channel))
      .catch((e: unknown) =>
        toast({
          title: "Not joined",
          type: "error",
          description: e instanceof Error ? e.message : undefined,
        }),
      );
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <h1 className="mr-auto text-xl font-semibold tracking-tight">
              Channels
            </h1>
            <Button variant="secondary" onClick={() => setSearching(true)}>
              <Search className="size-3.5" aria-hidden /> Search messages
            </Button>
            <Button variant="secondary" onClick={() => setMessaging(true)}>
              <MessageSquarePlus className="size-3.5" aria-hidden /> New message
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-3.5" aria-hidden /> New channel
            </Button>
          </div>
          <div className="relative mb-3">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Find a channel"
              placeholder="Find a channel"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-9 text-[14px]"
            />
          </div>
          <label className="mb-4 flex w-fit items-center gap-2 text-[12px] text-muted-foreground">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(checked) => setShowArchived(checked === true)}
            />
            Show archived channels
          </label>
          {!loaded && !list.length ? null : channels.length ? (
            <ul className="divide-y rounded-xl border bg-card">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    {c.kind === "private" ? (
                      <Lock className="size-4" aria-hidden />
                    ) : (
                      <Hash className="size-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={paths.channel(organization.slug, c.id)}
                      className="block truncate text-[14px] font-medium outline-none hover:underline focus-visible:underline"
                    >
                      {c.name}
                      {c.archivedAt && (
                        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                          archived
                        </span>
                      )}
                    </Link>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {c.topic ||
                        (c.kind === "private"
                          ? "Private channel"
                          : "Public channel")}
                    </p>
                  </div>
                  {c.member ? (
                    <span className="text-[12px] text-muted-foreground">
                      Joined
                    </span>
                  ) : (
                    !c.archivedAt && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => join(c)}
                      >
                        Join
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              illustration="inbox"
              title={query ? "No channel matches" : "No channels yet"}
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" aria-hidden /> New channel
                </Button>
              }
            >
              Channels are where conversations start. Promote what matters into
              proposals, decisions and discussions.
            </EmptyState>
          )}
          {direct.length > 0 && (
            <>
              <h2 className="mt-8 mb-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
                Direct messages
              </h2>
              <ul className="divide-y rounded-xl border bg-card">
                {direct.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={paths.channel(organization.slug, c.id)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[14px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                    >
                      <span className="flex -space-x-1">
                        {c.others.slice(0, 3).map((o) => (
                          <Avatar
                            key={o.id}
                            name={memberName(o.id)}
                            userId={o.kind === "user" ? o.id : null}
                            size="md"
                            className="ring-2 ring-card"
                          />
                        ))}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          c.unread > 0 && "font-semibold",
                        )}
                      >
                        {channelLabel(c, memberName)}
                      </span>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white tabular-nums">
                          {c.unread}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {searching && (
        <SearchPanel
          onClose={() => setSearching(false)}
          onOpen={(result: SearchResult) =>
            router.push(
              `${paths.channel(organization.slug, result.channelId)}?${result.message.threadRootId ? `thread=${result.message.threadRootId}&` : ""}message=${result.message.id}`,
            )
          }
        />
      )}
      {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
      {messaging && <NewMessageDialog onClose={() => setMessaging(false)} />}
    </div>
  );
}

const ORGANIZATION = "organization";

export function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const { organization, mutateConfirmed, projects, memberName } =
    useWorkspace();
  const router = useRouter();
  const ids = { name: useId(), topic: useId() };
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<"public" | "private">("public");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState("");
  const normalized = normalizeChannelName(name);
  const create = () => {
    if (!normalized) return;
    setError("");
    const channelId = crypto.randomUUID();
    mutateConfirmed({
      type: "createChannel",
      channelId,
      kind,
      name: normalized,
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      ...(projectId ? { home: { projectId } } : {}),
      ...(memberIds.length ? { memberIds } : {}),
    })
      .then(() => {
        onClose();
        router.push(paths.channel(organization.slug, channelId));
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message : "The channel was not created.",
        ),
      );
  };
  return (
    <Dialog
      title="New channel"
      description="Channels are where a team talks. Agents can be members too."
      onClose={onClose}
      onSubmit={create}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!normalized} onClick={create}>
            Create channel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Name"
          htmlFor={ids.name}
          hint={
            normalized && normalized !== name
              ? `Will be #${normalized}`
              : "Lowercase, without spaces: payments-releases"
          }
        >
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="payments"
            data-autofocus
          />
        </Field>
        <Field label="Topic" htmlFor={ids.topic} optional>
          <Input
            id={ids.topic}
            value={topic}
            maxLength={250}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What this channel is for"
          />
        </Field>
        <RadioCards
          legend="Visibility"
          name="channel-kind"
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "public",
              label: "Public",
              description: "Everyone in the organization can find and join it.",
            },
            {
              value: "private",
              label: "Private",
              description: "Only the people in it know it exists.",
            },
          ]}
        />
        {projects.filter((p) => !p.archivedAt).length > 0 && (
          <Field
            label="Project"
            optional
            hint="Homes the channel in a project, like #pay-releases."
          >
            <Select
              value={projectId || ORGANIZATION}
              onValueChange={(value) =>
                setProjectId(value === ORGANIZATION ? "" : value)
              }
            >
              <SelectTrigger aria-label="Project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ORGANIZATION}>
                  The whole organization
                </SelectItem>
                {projects
                  .filter((p) => !p.archivedAt)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="People" optional>
          <div className="flex flex-wrap items-center gap-1.5">
            {memberIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-2 pl-0.5 text-[12px]"
              >
                <Avatar name={memberName(id)} userId={id} size="sm" />
                {memberName(id)}
              </span>
            ))}
            <Popover
              width={280}
              trigger={(props) => (
                <Button {...props} size="sm" variant="secondary">
                  Add people
                </Button>
              )}
            >
              <PeoplePicker
                multiple
                value={memberIds}
                memberValue={(person) => person.id}
                onSelect={(id) =>
                  setMemberIds((ids) =>
                    ids.includes(id)
                      ? ids.filter((x) => x !== id)
                      : [...ids, id],
                  )
                }
              />
            </Popover>
          </div>
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

export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const { organization, memberName, userId } = useWorkspace();
  const router = useRouter();
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState("");
  const open = () => {
    setError("");
    callCapability<{ channelId: string }>("openDirectConversation", {
      organizationId: organization.id,
      userIds: people,
      mutationId: crypto.randomUUID(),
    })
      .then(({ channelId }) => {
        onClose();
        router.push(paths.channel(organization.slug, channelId));
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message : "The conversation did not open.",
        ),
      );
  };
  return (
    <Dialog
      title="New message"
      description="A direct message with one person, or a group conversation with up to eight."
      onClose={onClose}
      onSubmit={open}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!people.length} onClick={open}>
            Open conversation
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {people.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-2 pl-0.5 text-[12px]"
            >
              <Avatar name={memberName(id)} userId={id} size="sm" />
              {memberName(id)}
            </span>
          ))}
          <Popover
            width={280}
            trigger={(props) => (
              <Button {...props} size="sm" variant="secondary" data-autofocus>
                {people.length ? "Add someone" : "Choose people"}
              </Button>
            )}
          >
            <PeoplePicker
              multiple
              value={people}
              excludeIds={[userId]}
              memberValue={(person) => person.id}
              onSelect={(id) =>
                setPeople((ids) =>
                  ids.includes(id)
                    ? ids.filter((x) => x !== id)
                    : [...ids, id].slice(0, 8),
                )
              }
            />
          </Popover>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
