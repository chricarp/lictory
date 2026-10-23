import type { Chat } from "@ai-sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Link } from "@lictory/platform/lib/navigation";
import {
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Popover } from "@lictory/ui/popover";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type {
  ChatMessage,
  ChatSummary,
} from "@lictory/core/intelligence/chat/shared";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { useChats } from "@lictory/platform/components/intelligence/chat/provider";
import {
  useChatActivity,
  type ChatActivity,
} from "@lictory/platform/components/intelligence/chat/thread";

const DAY = 86_400_000;

function groupOf(chat: ChatSummary, now: number) {
  if (chat.pinned) return "Pinned";
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const at = new Date(chat.updatedAt).getTime();
  if (at >= startOfToday) return "Today";
  if (at >= startOfToday - DAY) return "Yesterday";
  if (at >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (at >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}
const order = [
  "Pinned",
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Previous 30 days",
  "Older",
];

export function chatLabel(chat: Pick<ChatSummary, "title" | "preview">) {
  return chat.title ?? chat.preview ?? "New conversation";
}

// Conversation history: pinned first, then by recency, with search, inline
// rename, pin and delete.
export function ChatList({ onNavigate }: { onNavigate?: () => void }) {
  const { chats, loaded, listError, activeId, newChat } = useChats();
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? chats.filter((c) =>
          `${c.title ?? ""} ${c.preview ?? ""}`.toLowerCase().includes(q),
        )
      : chats;
    const map = new Map<string, ChatSummary[]>();
    for (const chat of visible) {
      const g = groupOf(chat, now);
      map.set(g, [...(map.get(g) ?? []), chat]);
    }
    return order
      .filter((g) => map.has(g))
      .map((g) => ({ name: g, chats: map.get(g)! }));
  }, [chats, query, now]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <h2 className="flex-1 text-[13px] font-semibold">Conversations</h2>
        <button
          type="button"
          onClick={() => {
            newChat();
            onNavigate?.();
          }}
          aria-label="New conversation"
          title="New conversation"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <SquarePen className="size-4" aria-hidden />
        </button>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md bg-muted/60 px-2 text-[13px] focus-within:ring-2 focus-within:ring-ring/40">
          <Search className="size-3.5 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground touch:text-base"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>
      </div>
      <nav
        aria-label="Conversations"
        className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-2 pb-3"
      >
        {!loaded && <ListSkeleton />}
        {listError && (
          <p className="px-2 py-3 text-xs text-destructive">{listError}</p>
        )}
        {loaded && !chats.length && !listError && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
            <MessageSquare className="size-5 opacity-60" aria-hidden />
            Your conversations with Lictory Intelligence appear here.
          </div>
        )}
        {loaded && chats.length > 0 && !groups.length && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversation matches “{query}”.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.name} className="mt-2 first:mt-0">
            <h3 className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
              {group.name}
            </h3>
            <ul className="space-y-px">
              <AnimatePresence initial={false}>
                {group.chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    active={chat.id === activeId}
                    onNavigate={onNavigate}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 px-2 pt-2" aria-hidden>
      {[72, 56, 84, 64, 48].map((w, i) => (
        <div
          key={i}
          className="h-7 animate-pulse rounded-md bg-muted/70"
          style={{ width: `${w}%`, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onNavigate,
}: {
  chat: ChatSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { organization } = useWorkspace();
  const { rename, setPinned, remove, freshTitles, chatFor } = useChats();
  const live = chatFor(chat.id);
  const { toast } = useShell();
  const reduce = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const label = chatLabel(chat);
  const fail = (error: unknown) =>
    toast(error instanceof Error ? error.message : "That did not work.");

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const field = e.currentTarget.elements.namedItem("title");
    const title = field instanceof HTMLInputElement ? field.value.trim() : "";
    setEditing(false);
    if (title && title !== chat.title) rename(chat.id, title).catch(fail);
  };

  return (
    <motion.li
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8, height: 0 }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="group relative"
    >
      {active && (
        <motion.span
          layoutId="intelligence-active-chat"
          className="absolute inset-0 rounded-md bg-sidebar-accent"
          transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
        />
      )}
      {editing ? (
        <form onSubmit={submit} className="relative px-1 py-0.5">
          <input
            name="title"
            defaultValue={label}
            autoFocus
            maxLength={120}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label="Conversation title"
            className="h-7 w-full rounded-md border bg-background px-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40 touch:text-base"
          />
        </form>
      ) : (
        <Link
          href={paths.intelligenceChat(organization.slug, chat.id)}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          onDoubleClick={() => setEditing(true)}
          className={cn(
            "relative flex h-8 items-center gap-2 rounded-md pr-8 pl-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            active
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {chat.pinned && (
            <Pin
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={chat.title ?? "untitled"}
              initial={
                freshTitles.has(chat.id) && !reduce
                  ? { opacity: 0, filter: "blur(4px)", y: 4 }
                  : false
              }
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
              className={cn("truncate", !chat.title && "italic opacity-80")}
            >
              {label}
            </motion.span>
          </AnimatePresence>
          {live ? (
            <LiveStatus chat={live} />
          ) : (
            chat.awaitingInput && <ActivityIndicator activity="waiting" />
          )}
        </Link>
      )}
      {!editing && (
        <div className="absolute inset-y-0 right-1 flex items-center">
          <Popover
            width={180}
            align="end"
            onOpenChange={(open) => !open && setConfirming(false)}
            trigger={(props) => (
              <button
                {...props}
                aria-label={`Actions for ${label}`}
                className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            )}
          >
            {(close) => (
              <div className="p-1 text-[13px]">
                <MenuItem
                  icon={<PenLine />}
                  onClick={() => {
                    close();
                    setEditing(true);
                  }}
                >
                  Rename
                </MenuItem>
                <MenuItem
                  icon={chat.pinned ? <PinOff /> : <Pin />}
                  onClick={() => {
                    close();
                    setPinned(chat.id, !chat.pinned).catch(fail);
                  }}
                >
                  {chat.pinned ? "Unpin" : "Pin"}
                </MenuItem>
                <div className="my-1 border-t" />
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  onClick={() => {
                    if (!confirming) return setConfirming(true);
                    close();
                    remove(chat.id).catch(fail);
                  }}
                >
                  {confirming ? "Click again to delete" : "Delete"}
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      )}
    </motion.li>
  );
}

function LiveStatus({ chat }: { chat: Chat<ChatMessage> }) {
  const activity = useChatActivity(chat);
  return activity ? <ActivityIndicator activity={activity} /> : null;
}

const activityLabel: Record<ChatActivity, string> = {
  working: "Working",
  waiting: "Waiting for your input",
  failed: "Stopped with an error",
};

// Sits where the row's actions appear, and gives way to them on hover.
function ActivityIndicator({ activity }: { activity: ChatActivity }) {
  return (
    <span
      role="status"
      className="pointer-events-none absolute inset-y-0 right-1 grid w-6 place-items-center transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 group-has-[[data-state=open]]:opacity-0"
    >
      <span className="sr-only">{activityLabel[activity]}</span>
      {activity === "working" ? (
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border-[1.5px] border-primary/25 border-t-primary [animation-duration:0.9s] motion-reduce:animate-none"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            activity === "waiting"
              ? "bg-warning shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning)_22%,transparent)]"
              : "bg-destructive",
          )}
        />
      )}
    </span>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactElement;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted [&_svg]:size-3.5",
        danger ? "text-destructive" : "[&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
