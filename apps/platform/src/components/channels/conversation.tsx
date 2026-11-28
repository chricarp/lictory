import { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, Lock } from "lucide-react";
import {
  AgentAvatar,
  Facepile,
  PersonAvatar,
  type AgentIdentity,
  type Person,
} from "@lictory/platform/components/identity/actor";
import { paths } from "@lictory/core/lib/paths";
import { MissingState } from "@lictory/ui/status-page";
import { Button } from "@lictory/ui/button";
import { Spinner } from "@lictory/ui/spinner";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Link,
  useParams,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import {
  channelLabel,
  lastOwnMessage,
  threadSessions,
  type Channel,
  type MessageRow,
} from "@lictory/platform/components/channels/data";
import {
  useChannelMembers,
  useChannels,
  useConversation,
  useMirrorFailures,
  useMyThreads,
} from "@lictory/platform/components/channels/store";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  MessageList,
  useMessageWindow,
} from "@lictory/platform/components/channels/message-list";
import {
  ChannelMessage,
  type MessageActions,
  type PromotionChoice,
} from "@lictory/platform/components/channels/message";
import { Composer } from "@lictory/platform/components/channels/composer";
import type { Mentionable } from "@lictory/platform/components/editor/markdown-editor";
import { useFactory } from "@lictory/platform/components/factory/store";
import { activeStatuses } from "@lictory/platform/components/factory/labels";
import { useSessionStateOf } from "@lictory/platform/components/factory/parts";
import type { SessionState } from "@lictory/platform/lib/session-state";
import { ChannelHeader } from "@lictory/platform/components/channels/header";
import {
  SearchPanel,
  ThreadPanel,
} from "@lictory/platform/components/channels/side-panels";
import { PromoteDialog } from "@lictory/platform/components/channels/promote-dialog";
import { useAnnounceMessages } from "@lictory/platform/components/channels/announce";
import {
  TypingIndicator,
  useAnnounceTyping,
} from "@lictory/platform/components/channels/typing";

// /{org}/channels/{channel}: one conversation. The channel is addressed by
// its id (renames never break links); a name also resolves. `?thread=`
// opens a thread beside it and `?message=` scrolls to one message.

export function ChannelConversation() {
  const { organization } = useWorkspace();
  const { channel: param } = useParams<{ channel: string }>();
  const { byId, list, loaded } = useChannels();
  const channel =
    (param ? byId.get(param) : undefined) ??
    list.find((c) => c.kind !== "direct" && c.name === param?.toLowerCase());
  if (!channel)
    return loaded ? (
      // The whole page: its title is the page's h1.
      // Like every dead end, it offers a way on.
      <MissingState
        illustration="search"
        title="This channel is unavailable"
        action={
          <Button
            variant="secondary"
            render={<Link href={paths.channels(organization.slug)} />}
          >
            All channels
          </Button>
        }
      >
        It may be private, or the link may be wrong. Ask a member to add you.
      </MissingState>
    ) : (
      <div className="grid h-full place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  // A new conversation (and its window) for every channel.
  return <Conversation key={channel.id} channel={channel} />;
}

function Conversation({ channel }: { channel: Channel }) {
  const workspace = useWorkspace();
  const { organization, userId, memberName, isAdmin, directory } = workspace;
  const router = useRouter();
  const search = useSearchParams();
  const threadId = search.get("thread") ?? undefined;
  const focusMessageId = search.get("message") ?? undefined;
  const [searchOpen, setSearchOpen] = useState(false);
  const conversation = useConversation();
  const members = useChannelMembers(channel.id);
  const threads = useMyThreads();
  const history = useMessageWindow(channel);
  const sendFailures = useMirrorFailures(
    channel.id,
    channel.externalSource === "slack",
  );
  const label = channelLabel(channel, memberName);
  const title = channel.kind === "direct" ? label : `#${label}`;
  const [editingId, setEditingId] = useState<string>();
  const [promoting, setPromoting] = useState<{
    kind: PromotionChoice;
    message: MessageRow;
  }>();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const canPost = Boolean(channel.member) && !channel.archivedAt;
  const announceTyping = useAnnounceTyping(channel.id);
  const canReact = !channel.archivedAt;
  const factory = useFactory();
  // People and agents autocomplete after @. Mentioning an agent you may use
  // starts its session in the message's thread.
  const mentions = useMemo<Mentionable[]>(
    () => [
      ...directory.members,
      ...factory.agents
        .filter((a) => !a.archivedAt && a.kind !== "intelligence")
        .map((a) => ({
          id: a.id,
          name: a.name,
          handle: a.handle,
          kind: "agent" as const,
          avatar: a.avatar,
        })),
    ],
    [directory.members, factory.agents],
  );
  // Where the agent session of each thread stands, for the channel's thread
  // summaries, keyed so the map only changes when a state does (sessions
  // update often).
  const stateOf = useSessionStateOf();
  const statesKey = JSON.stringify(
    [...threadSessions(factory.sessions, channel.id)].map(([root, session]) => [
      root,
      stateOf(session, factory.agentById.get(session.agentId)),
    ]),
  );
  const threadStates = useMemo(
    () =>
      new Map<string, SessionState>(
        JSON.parse(statesKey) as [string, SessionState][],
      ),
    [statesKey],
  );
  const agentNameOf = useCallback(
    (id: string | null | undefined) =>
      (id ? factory.agentById.get(id)?.name : undefined) ?? "Agent",
    [factory.agentById],
  );
  const agentOf = useCallback(
    (id: string | null | undefined) =>
      id ? factory.agentById.get(id) : undefined,
    [factory.agentById],
  );
  // Who said a message, for the screen reader announcement of new ones.
  const speakerOf = useCallback(
    (message: MessageRow) =>
      message.authorKind === "agent"
        ? agentNameOf(message.authorAgentId)
        : message.authorKind === "external"
          ? (message.externalAuthorName ?? "Someone")
          : memberName(message.authorUserId),
    [agentNameOf, memberName],
  );
  useAnnounceMessages(
    channel.id,
    history.messages,
    history.complete,
    userId,
    speakerOf,
  );
  // A thread an agent session is working in: replies by its requester or
  // the agent's owner steer it, anyone else's stay conversation.
  const threadSession = threadId
    ? factory.sessions.find(
        (s) =>
          s.channelId === channel.id &&
          s.threadRootMessageId === threadId &&
          activeStatuses.includes(s.status),
      )
    : undefined;
  const threadAgent = threadSession
    ? factory.agentById.get(threadSession.agentId)
    : undefined;
  const steers =
    threadSession &&
    (threadSession.requestedById === userId || threadAgent?.ownerId === userId);
  const base = paths.channel(organization.slug, channel.id);

  useEffect(() => {
    document.title = `${title} · ${organization.name}`;
  }, [title, organization.name]);

  const setQuery = useCallback(
    (next: Record<string, string | undefined>) => {
      const params = new URLSearchParams(search);
      for (const [key, value] of Object.entries(next))
        if (value) params.set(key, value);
        else params.delete(key);
      const query = params.toString();
      router.replace(query ? `${base}?${query}` : base, { scroll: false });
    },
    [search, router, base],
  );
  const openThread = useCallback(
    (message: MessageRow) => {
      setSearchOpen(false);
      setQuery({
        thread: message.threadRootId ?? message.id,
        message: undefined,
      });
    },
    [setQuery],
  );
  const closeThread = useCallback(
    () => setQuery({ thread: undefined }),
    [setQuery],
  );

  // Escape closes the side panel (a dialog or menu handles its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-popover], [role=dialog]")) return;
      if (threadId) closeThread();
      else if (searchOpen) setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threadId, searchOpen, closeThread]);

  const send = useCallback(
    (body: string, threadRootId?: string) => {
      const messageId = crypto.randomUUID();
      setPending((p) => new Set(p).add(messageId));
      const call = conversation.send({
        channelId: channel.id,
        messageId,
        body,
        threadRootId: threadRootId ?? null,
      });
      void call.server.finally(() =>
        setPending((p) => {
          const next = new Set(p);
          next.delete(messageId);
          return next;
        }),
      );
    },
    [conversation, channel.id],
  );

  const actions: MessageActions = useMemo(
    () => ({
      react: (message, emoji, add) =>
        void conversation.react(channel.id, message.id, emoji, add),
      openThread,
      edit: (message, body) =>
        void conversation.edit(channel.id, message.id, body),
      remove: (message) => {
        void conversation.remove(channel.id, message.id);
        toast({ title: "Message deleted", duration: 4000 });
      },
      promote: (message, kind) => setPromoting({ kind, message }),
      copyLink: (message) => {
        const query = message.threadRootId
          ? `?thread=${message.threadRootId}&message=${message.id}`
          : `?message=${message.id}`;
        void navigator.clipboard
          .writeText(`${location.origin}${base}${query}`)
          .then(() => toast({ title: "Link copied", duration: 2500 }));
      },
      markUnread: channel.member
        ? (message) =>
            void conversation.markRead(channel.id, message.sequence - 1, true)
        : undefined,
      retrySync: (message) =>
        void callCapability("retrySlackMessage", {
          organizationId: organization.id,
          channelId: channel.id,
          messageId: message.id,
        }).catch((e: unknown) =>
          toast({
            title: "Not retried",
            type: "error",
            description: e instanceof Error ? e.message : undefined,
          }),
        ),
    }),
    [
      conversation,
      channel.id,
      channel.member,
      openThread,
      base,
      organization.id,
    ],
  );

  const render = useCallback(
    (message: MessageRow, grouped: boolean, inThread = false) => (
      <ChannelMessage
        message={message}
        grouped={grouped}
        userId={userId}
        isAdmin={isAdmin}
        canPost={canPost}
        canReact={canReact}
        pending={pending.has(message.id)}
        highlighted={message.id === focusMessageId}
        editing={editingId === message.id}
        onEditingChange={(on) => setEditingId(on ? message.id : undefined)}
        nameOf={memberName}
        agentNameOf={agentNameOf}
        agentOf={agentOf}
        mentions={mentions}
        actions={actions}
        inThread={inThread}
        threadState={threadStates.get(message.id)}
        syncError={sendFailures.get(message.id)}
      />
    ),
    [
      threadStates,
      agentNameOf,
      agentOf,
      userId,
      isAdmin,
      canPost,
      canReact,
      pending,
      focusMessageId,
      editingId,
      memberName,
      mentions,
      actions,
      sendFailures,
    ],
  );
  const renderInThread = useCallback(
    (message: MessageRow, grouped: boolean) => render(message, grouped, true),
    [render],
  );

  const editLast = () => {
    const last = lastOwnMessage(history.messages, userId);
    if (!last) return false;
    setEditingId(last.id);
    return true;
  };
  const participant = threads.find((t) => t.rootMessageId === threadId);
  const disabledReason = channel.archivedAt
    ? "This channel is archived. Its history stays; restore it to post again."
    : undefined;
  return (
    <div className="flex h-full min-h-0">
      <section aria-label={title} className="flex min-w-0 flex-1 flex-col">
        <ChannelHeader
          channel={channel}
          label={label}
          members={members}
          searchOpen={searchOpen}
          onToggleSearch={() => {
            setSearchOpen((open) => !open);
            if (threadId) closeThread();
          }}
        />
        <MessageList
          channel={channel}
          window={history}
          userId={userId}
          focusMessageId={threadId ? undefined : focusMessageId}
          renderMessage={render}
          onMarkRead={(sequence) =>
            void conversation.markRead(channel.id, sequence)
          }
          empty={<ChannelStart channel={channel} label={label} />}
        />
        <TypingIndicator channelId={channel.id} />
        {channel.member ? (
          <Composer
            draftKey={`${organization.id}:${channel.id}`}
            organizationId={organization.id}
            channelId={channel.id}
            label={`Message ${title}`}
            placeholder={`Message ${title}`}
            mentions={mentions}
            disabled={!canPost}
            disabledReason={disabledReason}
            onSend={(body) => send(body)}
            onEditLast={editLast}
            onTyping={announceTyping}
            autoFocus
          />
        ) : (
          <JoinBar channel={channel} label={label} />
        )}
      </section>
      {threadId ? (
        <ThreadPanel
          key={threadId}
          channel={channel}
          label={title}
          rootMessageId={threadId}
          participant={participant}
          renderMessage={renderInThread}
          speakerOf={speakerOf}
          onClose={closeThread}
          onRead={(rootId) =>
            void conversation.thread(channel.id, rootId, { read: true })
          }
          onFollow={(rootId, following) =>
            void conversation.thread(channel.id, rootId, {
              following,
              read: true,
            })
          }
          composer={
            canPost ? (
              <Composer
                key={threadId}
                draftKey={`${organization.id}:${channel.id}:${threadId}`}
                organizationId={organization.id}
                channelId={channel.id}
                label="Reply in thread"
                placeholder={
                  threadSession && threadAgent
                    ? steers
                      ? `Reply to steer ${threadAgent.name}…`
                      : `Reply… (${threadAgent.name} takes instructions only from ${[
                          ...new Set([
                            memberName(threadSession.requestedById),
                            memberName(threadAgent.ownerId),
                          ]),
                        ].join(" and ")})`
                    : "Reply…"
                }
                mentions={mentions}
                onSend={(body) => send(body, threadId)}
                onEscape={closeThread}
                // The narrow panel keeps the keys that matter on one line.
                hint="Enter to send · Shift+Enter for a new line"
                autoFocus
              />
            ) : null
          }
        />
      ) : searchOpen ? (
        <SearchPanel
          channel={channel}
          onClose={() => setSearchOpen(false)}
          onOpen={(result) => {
            setSearchOpen(false);
            setQuery({
              thread: result.message.threadRootId ?? undefined,
              message: result.message.id,
            });
          }}
        />
      ) : null}
      {promoting && (
        <PromoteDialog
          kind={promoting.kind}
          message={promoting.message}
          channelId={channel.id}
          onClose={() => setPromoting(undefined)}
        />
      )}
    </div>
  );
}

function ChannelStart({ channel, label }: { channel: Channel; label: string }) {
  const { directory, memberName } = useWorkspace();
  const { agentById } = useFactory();
  const direct = channel.kind === "direct";
  // A direct message starts with the people in it, not a channel's "#".
  const others = channel.others.flatMap(
    (o): (Person | (AgentIdentity & { agent: true }))[] => {
      if (o.kind === "agent") {
        const agent = agentById.get(o.id);
        return agent ? [{ ...agent, agent: true as const }] : [];
      }
      return [
        {
          id: o.id,
          name: memberName(o.id),
          image: directory.members.find((m) => m.id === o.id)?.image ?? null,
        },
      ];
    },
  );
  return (
    <div className="space-y-1">
      <div className="mb-3">
        {direct && others.length === 1 ? (
          "agent" in others[0]! ? (
            <AgentAvatar agent={others[0]} size={36} />
          ) : (
            <PersonAvatar person={others[0]!} size={36} />
          )
        ) : direct && others.length > 1 ? (
          <Facepile people={others} size={36} max={4} />
        ) : (
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            {channel.kind === "private" ? (
              <Lock className="size-5" aria-hidden />
            ) : (
              <Hash className="size-5" aria-hidden />
            )}
          </span>
        )}
      </div>
      <h2 className="text-lg font-semibold">
        {direct ? label : `Welcome to #${label}`}
      </h2>
      <p className="text-[13px] text-muted-foreground">
        {direct
          ? others.length === 1
            ? `This is the start of your conversation with ${others[0]!.name}.`
            : "This is the start of your conversation."
          : channel.topic ||
            "This is the start of the channel. Start a conversation, then promote what matters into a proposal, a decision or a discussion on a specification."}
      </p>
    </div>
  );
}

function JoinBar({ channel, label }: { channel: Channel; label: string }) {
  const { mutateConfirmed } = useWorkspace();
  if (channel.archivedAt)
    return (
      <div className="mx-3 mb-3 rounded-xl border bg-muted/40 px-4 py-3 text-center text-[13px] text-muted-foreground sm:mx-4">
        This channel is archived. Its history stays readable.
      </div>
    );
  return (
    <div className="mx-3 mb-3 flex flex-wrap items-center justify-center gap-3 rounded-xl border bg-muted/40 px-4 py-3 text-[13px] sm:mx-4">
      <span className="text-muted-foreground">
        You are reading{" "}
        <span className="font-medium text-foreground">#{label}</span>.
      </span>
      <Button
        size="sm"
        onClick={() =>
          mutateConfirmed({ type: "joinChannel", channelId: channel.id }).catch(
            (e: unknown) =>
              toast({
                title: "Not joined",
                type: "error",
                description: e instanceof Error ? e.message : undefined,
              }),
          )
        }
      >
        Join channel
      </Button>
    </div>
  );
}
