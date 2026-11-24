import { useCallback, useMemo } from "react";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { mutators } from "@lictory/zero/mutators";
import { queries } from "@lictory/zero/queries";
import { attentionCount } from "@lictory/core/channels/shared";
import { toast } from "@lictory/ui/toast";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  rejectionOf,
  type MutationCall,
} from "@lictory/platform/data/mutations";
import {
  indexChannels,
  type ChannelRow,
  type MemberRow,
  type MessageRow,
} from "@lictory/platform/components/channels/data";

// Lictory Channels in the browser: Zero subscriptions (authorized on the
// server by channel access) and the conversation writer's mutators. Zero
// deduplicates identical subscriptions, so every component asks for what it
// needs and the sidebar and the conversation share one subscription.

// Keep a conversation's rows a while after leaving it, so going back is
// instant.
const CHANNEL_TTL = "5m";

/** Every channel I can read, with my membership and unread counts. */
export function useChannels() {
  const { organization, userId } = useWorkspace();
  const organizationId = organization.id;
  const [channels, channelsResult] = useQuery(
    queries.channels({ organizationId }),
  );
  const [memberships] = useQuery(
    queries.myChannelMemberships({ organizationId }),
  );
  const [direct] = useQuery(
    queries.directConversationMembers({ organizationId }),
  );
  const index = useMemo(
    () =>
      indexChannels(
        channels as readonly ChannelRow[],
        memberships as readonly MemberRow[],
        direct as readonly MemberRow[],
        userId,
      ),
    [channels, memberships, direct, userId],
  );
  return { ...index, loaded: channelsResult.type === "complete" };
}

/**
 * Unread mentions and direct messages: the sidebar's badges, which the shell
 * also adds to the desktop badge. `channels` counts mentions in channels,
 * `direct` everything unread in direct conversations (mentions there too),
 * so the two add up to `total`.
 */
export function useChannelAttention() {
  const { list } = useChannels();
  return useMemo(() => {
    const members = new Map(
      list.flatMap((c) =>
        c.member && !c.archivedAt ? [[c.id, c.member] as const] : [],
      ),
    );
    const idOf = (c: (typeof list)[number]) => c.id;
    const channels = attentionCount(
      list.filter((c) => c.kind !== "direct"),
      members,
      idOf,
    ).total;
    const direct = attentionCount(
      list.filter((c) => c.kind === "direct"),
      members,
      idOf,
    ).total;
    return { channels, direct, total: channels + direct };
  }, [list]);
}

/** A window of a channel's top-level messages, oldest first. */
export function useChannelMessages(
  channelId: string | undefined,
  limit: number,
  fromSequence?: number,
) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.channelMessages({
      organizationId: organization.id,
      channelId: channelId ?? "none",
      limit,
      ...(fromSequence !== undefined ? { fromSequence } : {}),
    }),
    { enabled: Boolean(channelId), ttl: CHANNEL_TTL },
  );
  const messages = useMemo(() => {
    const list = [...(rows as readonly MessageRow[])];
    list.sort((a, b) => a.sequence - b.sequence);
    return list;
  }, [rows]);
  return {
    messages,
    complete: result.type === "complete",
    // Fewer rows than asked for: the window reaches the first message.
    reachedStart:
      result.type === "complete" &&
      fromSequence === undefined &&
      rows.length < limit,
  };
}

export function useChannelThread(
  channelId: string | undefined,
  rootMessageId: string | undefined,
) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.channelThread({
      organizationId: organization.id,
      channelId: channelId ?? "none",
      rootMessageId: rootMessageId ?? "none",
    }),
    { enabled: Boolean(channelId && rootMessageId), ttl: CHANNEL_TTL },
  );
  return useMemo(() => {
    const list = rows as readonly MessageRow[];
    return {
      root: list.find((m) => m.id === rootMessageId),
      replies: list
        .filter((m) => m.threadRootId === rootMessageId)
        .sort((a, b) => a.sequence - b.sequence),
      complete: result.type === "complete",
    };
  }, [rows, rootMessageId, result.type]);
}

export function useChannelMembers(channelId: string | undefined) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.channelMembers({
      organizationId: organization.id,
      channelId: channelId ?? "none",
    }),
    { enabled: Boolean(channelId), ttl: CHANNEL_TTL },
  );
  return rows as readonly MemberRow[];
}

export function useMyThreads() {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.myChannelThreads({ organizationId: organization.id }),
  );
  return rows;
}

// A conversation write failed on the server: Zero removed its prediction;
// say why, once.
function reportRejection(call: MutationCall, what: string) {
  void call.server.then((outcome) => {
    if (outcome.type !== "error") return;
    const rejection = rejectionOf(outcome);
    toast({
      title: `${what} failed`,
      type: "error",
      description: rejection.message,
      duration: 8000,
    });
  });
  return call;
}

/** The conversation writer's operations for the current organization. */
export function useConversation() {
  const zero = useZero();
  const { organization } = useWorkspace();
  const organizationId = organization.id;
  const send = useCallback(
    (args: {
      channelId: string;
      messageId: string;
      body: string;
      threadRootId?: string | null;
      attachments?: {
        id: string;
        filename: string;
        mimeType: string;
        size: number;
      }[];
    }) =>
      reportRejection(
        zero.mutate(
          mutators.channels.send({
            organizationId,
            ...args,
            attachmentIds: args.attachments?.map((a) => a.id),
          }),
        ),
        "Sending",
      ),
    [zero, organizationId],
  );
  const edit = useCallback(
    (channelId: string, messageId: string, body: string) =>
      reportRejection(
        zero.mutate(
          mutators.channels.edit({
            organizationId,
            channelId,
            messageId,
            body,
          }),
        ),
        "Editing",
      ),
    [zero, organizationId],
  );
  const remove = useCallback(
    (channelId: string, messageId: string) =>
      reportRejection(
        zero.mutate(
          mutators.channels.remove({ organizationId, channelId, messageId }),
        ),
        "Deleting",
      ),
    [zero, organizationId],
  );
  const react = useCallback(
    (channelId: string, messageId: string, emoji: string, add: boolean) =>
      reportRejection(
        zero.mutate(
          mutators.channels.react({
            organizationId,
            channelId,
            messageId,
            emoji,
            add,
          }),
        ),
        "Reacting",
      ),
    [zero, organizationId],
  );
  const markRead = useCallback(
    (channelId: string, sequence: number, unread = false) =>
      zero.mutate(
        mutators.channels.markRead({
          organizationId,
          channelId,
          sequence,
          ...(unread ? { unread } : {}),
        }),
      ),
    [zero, organizationId],
  );
  const thread = useCallback(
    (
      channelId: string,
      rootMessageId: string,
      change: { read?: boolean; following?: boolean },
    ) =>
      zero.mutate(
        mutators.channels.thread({
          organizationId,
          channelId,
          rootMessageId,
          ...change,
        }),
      ),
    [zero, organizationId],
  );
  return useMemo(
    () => ({ send, edit, remove, react, markRead, thread }),
    [send, edit, remove, react, markRead, thread],
  );
}

export type ChannelLinkRow = {
  readonly id: string;
  readonly source: string;
  readonly externalId: string;
  readonly externalName: string;
  readonly externalUrl: string | null;
  readonly health: string;
  readonly lastError: string | null;
  readonly lastSyncedAt: number | null;
};

/** The channel's active link to a Slack channel, with its health. */
export function useChannelLink(channelId: string, linked: boolean) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.channelExternalLink({
      organizationId: organization.id,
      channelId,
    }),
    { enabled: linked, ttl: CHANNEL_TTL },
  );
  return linked
    ? ((rows as readonly ChannelLinkRow[])[0] ?? undefined)
    : undefined;
}

/** Lictory messages of the channel that could not reach Slack, by id. */
export function useMirrorFailures(channelId: string, linked: boolean) {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.channelMirrorFailures({
      organizationId: organization.id,
      channelId,
    }),
    { enabled: linked, ttl: CHANNEL_TTL },
  );
  return useMemo(
    () =>
      new Map(
        (
          rows as readonly { messageId: string; lastError: string | null }[]
        ).map((r) => [r.messageId, r.lastError ?? "Not sent to Slack."]),
      ),
    [rows],
  );
}
