import { useEffect, useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Bot,
  ChevronRight,
  Hash,
  Lock,
  MessagesSquare,
  Plus,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { Avatar } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Link, usePathname } from "@lictory/platform/lib/navigation";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import { desktop } from "@lictory/platform/lib/desktop";
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

// Sidebar sections for Lictory Channels, for the shell's navigation:
// joined channels and direct conversations, each with its unread state. A
// channel with unread messages reads bold; mentions (and direct messages)
// carry a count, because they ask something of you. Muted channels never
// read bold.

function Section({
  id,
  label,
  addLabel,
  onAdd,
  collapsed,
  children,
}: {
  id: "sidebar-channels" | "sidebar-direct";
  label: string;
  addLabel: string;
  onAdd: () => void;
  collapsed: boolean;
  children: ReactNode;
}) {
  const { organization } = useWorkspace();
  const [folded, toggle] = usePanelCollapsed(organization.id, id);
  return (
    <Collapsible open={!folded || collapsed} onOpenChange={toggle}>
      {collapsed ? (
        <div className="mx-1 mb-2 border-t" />
      ) : (
        <div className="mb-1 flex h-6 items-center gap-1">
          <CollapsibleTrigger className="group flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
            {label}
            <ChevronRight
              aria-hidden
              className="size-3 transition-transform duration-150 group-data-open:rotate-90"
            />
          </CollapsibleTrigger>
          <button
            type="button"
            aria-label={addLabel}
            title={addLabel}
            onClick={onAdd}
            className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
      <CollapsiblePanel className="space-y-0.5">{children}</CollapsiblePanel>
    </Collapsible>
  );
}

function Item({
  href,
  active,
  icon,
  label,
  unread,
  count,
  collapsed,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  unread: boolean;
  count: number;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "size-8 justify-center" : "h-8 gap-2.5 px-2.5",
        active
          ? "bg-sidebar-accent font-medium text-foreground shadow-(--shadow-border)"
          : unread
            ? "font-semibold text-foreground hover:bg-sidebar-accent/70"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <span aria-hidden className="grid size-4 shrink-0 place-items-center">
        {icon}
      </span>
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>
        {label}
        {unread && <span className="sr-only">, unread</span>}
      </span>
      {count > 0 && (
        <span
          className={cn(
            "rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white tabular-nums",
            collapsed && "absolute -top-0.5 -right-1 px-1",
          )}
        >
          {count > 99 ? "99+" : count}
          <span className="sr-only">
            {count === 1 ? " mention" : " mentions"}
          </span>
        </span>
      )}
    </Link>
  );
}

const unreadOf = (c: Channel) =>
  c.unread > 0 && c.member?.notificationLevel !== "none";

// The desktop app's dock or taskbar badge: unread mentions and direct
// messages of this organization (channel traffic never counts).
function DesktopBadge() {
  const { total } = useChannelAttention();
  useEffect(() => {
    desktop()?.setBadge(total);
  }, [total]);
  return null;
}

/** Joined channels, alphabetically, with unread state and mention counts. */
export function ChannelsNavSection({
  collapsed = false,
}: {
  // The shell's narrow rail: icons only.
  collapsed?: boolean;
}) {
  const { organization } = useWorkspace();
  const pathname = usePathname();
  const { list } = useChannels();
  const [creating, setCreating] = useState(false);
  const channels = sidebarChannels(list);
  const all = paths.channels(organization.slug);
  return (
    <>
      <DesktopBadge />
      <Section
        id="sidebar-channels"
        label="Channels"
        addLabel="New channel"
        onAdd={() => setCreating(true)}
        collapsed={collapsed}
      >
        <Item
          href={all}
          active={pathname === all}
          icon={<MessagesSquare className="size-4" />}
          label="All channels"
          unread={false}
          count={0}
          collapsed={collapsed}
        />
        {channels.map((c) => {
          const href = paths.channel(organization.slug, c.id);
          return (
            <Item
              key={c.id}
              href={href}
              active={pathname === href}
              icon={
                c.kind === "private" ? (
                  <Lock className="size-3.5" />
                ) : (
                  <Hash className="size-3.5" />
                )
              }
              label={c.name ?? "channel"}
              unread={unreadOf(c)}
              count={c.mentions}
              collapsed={collapsed}
            />
          );
        })}
        {creating && <CreateChannelDialog onClose={() => setCreating(false)} />}
      </Section>
    </>
  );
}

/** Recent direct conversations; every unread message counts. */
export function DirectMessagesNavSection({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { organization, memberName } = useWorkspace();
  const pathname = usePathname();
  const { list } = useChannels();
  const [messaging, setMessaging] = useState(false);
  const conversations = sidebarDirect(list);
  return (
    <Section
      id="sidebar-direct"
      label="Direct messages"
      addLabel="New message"
      onAdd={() => setMessaging(true)}
      collapsed={collapsed}
    >
      {conversations.map((c) => {
        const href = paths.channel(organization.slug, c.id);
        const first = c.others[0];
        const muted = c.member?.notificationLevel === "none";
        return (
          <Item
            key={c.id}
            href={href}
            active={pathname === href}
            icon={
              first?.kind === "agent" ? (
                <Bot className="size-3.5" />
              ) : (
                <Avatar
                  name={first ? memberName(first.id) : "You"}
                  userId={first?.id}
                  size="xs"
                  className={cn(c.others.length > 1 && "rounded")}
                />
              )
            }
            label={channelLabel(c, memberName)}
            unread={unreadOf(c)}
            count={muted ? 0 : c.unread}
            collapsed={collapsed}
          />
        );
      })}
      {!conversations.length && !collapsed && (
        <p className="px-2.5 text-[12px] text-muted-foreground">
          No conversations yet.
        </p>
      )}
      {messaging && <NewMessageDialog onClose={() => setMessaging(false)} />}
    </Section>
  );
}
