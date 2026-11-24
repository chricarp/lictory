import { useMemo, useState } from "react";
import { AtSign, Bot, Hash, Lock, MessagesSquare, Plus } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { Avatar } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  SidebarAction,
  SidebarGroup,
  SidebarLink,
  SidebarNote,
  useNavActive,
} from "@lictory/platform/components/shell/sidebar-parts";
import type {
  NavBadge,
  NavSection,
  NavSectionProps,
  PaletteEntry,
  PaletteProvider,
} from "@lictory/platform/components/shell/nav-registry";
import {
  useChannelAttention,
  useChannels,
} from "@lictory/platform/components/channels/store";
import {
  channelLabel,
  sidebarChannels,
  sidebarDirect,
  type Channel,
} from "@lictory/platform/components/channels/data";
import {
  CreateChannelDialog,
  NewMessageDialog,
} from "@lictory/platform/components/channels/browser";

// Lictory Channels in the shell (components/shell/nav-registry.tsx): the
// Channels and Direct messages sections, their badges and the palette's
// conversations. A channel with unread messages reads bold; mentions (and
// direct messages) carry a count, because they ask something of you. Muted
// channels never read bold. The badges count toward the desktop badge.

const unreadOf = (c: Channel) =>
  c.unread > 0 && c.member?.notificationLevel !== "none";

// A row's own count: mentions, or every unread direct message.
function rowBadge(count: number, label: string): NavBadge | null {
  return count > 0 ? { count, label, tone: "strong" } : null;
}

function ChannelsSection({ badge }: NavSectionProps) {
  const { organization } = useWorkspace();
  const active = useNavActive();
  const { list } = useChannels();
  const [creating, setCreating] = useState(false);
  const channels = sidebarChannels(list);
  const all = paths.channels(organization.slug);
  return (
    <SidebarGroup
      id="channels"
      label="Channels"
      badge={badge}
      actions={
        <SidebarAction label="New channel" onClick={() => setCreating(true)}>
          <Plus />
        </SidebarAction>
      }
    >
      <SidebarLink
        href={all}
        active={active(all, true)}
        icon={<MessagesSquare />}
      >
        All channels
      </SidebarLink>
      {channels.map((c) => {
        const href = paths.channel(organization.slug, c.id);
        return (
          <SidebarLink
            key={c.id}
            href={href}
            active={active(href)}
            icon={c.kind === "private" ? <Lock /> : <Hash />}
            unread={unreadOf(c)}
            badge={rowBadge(
              c.mentions,
              c.mentions === 1 ? "mention" : "mentions",
            )}
          >
            {c.name ?? "channel"}
          </SidebarLink>
        );
      })}
      {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
    </SidebarGroup>
  );
}

function DirectMessagesSection({ badge }: NavSectionProps) {
  const { organization, memberName } = useWorkspace();
  const active = useNavActive();
  const { list } = useChannels();
  const [messaging, setMessaging] = useState(false);
  const conversations = sidebarDirect(list);
  return (
    <SidebarGroup
      id="direct-messages"
      label="Direct messages"
      badge={badge}
      actions={
        <SidebarAction label="New message" onClick={() => setMessaging(true)}>
          <Plus />
        </SidebarAction>
      }
    >
      {conversations.map((c) => {
        const href = paths.channel(organization.slug, c.id);
        const first = c.others[0];
        const muted = c.member?.notificationLevel === "none";
        const count = muted ? c.mentions : c.unread;
        return (
          <SidebarLink
            key={c.id}
            href={href}
            active={active(href)}
            icon={
              first?.kind === "agent" ? (
                <Bot />
              ) : (
                <Avatar
                  name={first ? memberName(first.id) : "You"}
                  userId={first?.id}
                  size="xs"
                  className={cn(c.others.length > 1 && "rounded")}
                />
              )
            }
            unread={unreadOf(c)}
            badge={rowBadge(count, "unread")}
          >
            {channelLabel(c, memberName)}
          </SidebarLink>
        );
      })}
      {!conversations.length && (
        <SidebarNote>No conversations yet.</SidebarNote>
      )}
      {messaging && <NewMessageDialog onClose={() => setMessaging(false)} />}
    </SidebarGroup>
  );
}

export const channelsSection: NavSection = {
  id: "channels",
  label: "Channels",
  icon: Hash,
  href: paths.channels,
  useBadge: () => {
    const { channels } = useChannelAttention();
    return channels > 0
      ? {
          count: channels,
          label: channels === 1 ? "unread mention" : "unread mentions",
          tone: "strong",
          dock: true,
        }
      : null;
  },
  Section: ChannelsSection,
};

export const directMessagesSection: NavSection = {
  id: "direct-messages",
  label: "Direct messages",
  icon: AtSign,
  href: paths.channels,
  useBadge: () => {
    const { direct } = useChannelAttention();
    return direct > 0
      ? {
          count: direct,
          label: direct === 1 ? "unread message" : "unread messages",
          tone: "strong",
          dock: true,
        }
      : null;
  },
  Section: DirectMessagesSection,
};

// Jump to a conversation: unread ones first, then channels by name and
// direct conversations by recency.
export const channelsPalette: PaletteProvider = {
  id: "channels",
  group: "Conversations",
  useEntries: () => {
    const { organization, memberName } = useWorkspace();
    const { list } = useChannels();
    return useMemo(() => {
      const org = organization.slug;
      const conversations = [
        ...sidebarDirect(list, 50),
        ...sidebarChannels(list),
      ].sort((a, b) => Number(unreadOf(b)) - Number(unreadOf(a)));
      return conversations.map((c): PaletteEntry => {
        const direct = c.kind === "direct";
        return {
          id: `channel-${c.id}`,
          label: direct
            ? channelLabel(c, memberName)
            : `#${c.name ?? "channel"}`,
          hint: direct ? "Direct message" : "Channel",
          icon: direct ? (
            <AtSign className="size-4" />
          ) : c.kind === "private" ? (
            <Lock className="size-4" />
          ) : (
            <Hash className="size-4" />
          ),
          keywords: direct ? "direct message" : "channel",
          href: paths.channel(org, c.id),
        };
      });
    }, [list, organization.slug, memberName]);
  },
};
