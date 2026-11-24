import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, Search, X } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { cn } from "@lictory/core/lib/utils";
import { Input } from "@lictory/ui/input";
import { Spinner } from "@lictory/ui/spinner";
import { useDebouncedCallback } from "@lictory/ui/use-debounced-callback";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useChannelThread } from "@lictory/platform/components/channels/store";
import {
  formatTime,
  type Channel,
  type MessageRow,
} from "@lictory/platform/components/channels/data";

// The right-hand panels of a conversation: a thread (?thread=) or message
// search. On phones they cover the conversation; Escape closes them.

function Panel({
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="fixed inset-0 z-30 flex flex-col bg-background lg:static lg:z-auto lg:w-[26rem] lg:shrink-0 lg:border-l"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold">{title}</h2>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions}
        <button
          type="button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {children}
    </aside>
  );
}

export function ThreadPanel({
  channel,
  label,
  rootMessageId,
  participant,
  renderMessage,
  composer,
  onClose,
  onRead,
  onFollow,
}: {
  channel: Channel;
  label: string;
  rootMessageId: string;
  participant: { following: boolean; readReplyCount: number } | undefined;
  renderMessage: (message: MessageRow, grouped: boolean) => ReactNode;
  composer: ReactNode;
  onClose: () => void;
  onRead: (rootMessageId: string) => void;
  onFollow: (rootMessageId: string, following: boolean) => void;
}) {
  const { root, replies, complete } = useChannelThread(
    channel.id,
    rootMessageId,
  );
  const end = useRef<HTMLDivElement>(null);
  const following = participant?.following ?? false;
  // Reading the open thread keeps it read as replies arrive.
  useEffect(() => {
    if (
      root &&
      participant &&
      participant.readReplyCount < root.replyCount &&
      document.visibilityState === "visible"
    )
      onRead(root.id);
  }, [root, participant, onRead]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [replies.length]);
  return (
    <Panel
      title="Thread"
      subtitle={label}
      onClose={onClose}
      actions={
        root && (
          <button
            type="button"
            aria-pressed={following}
            onClick={() => onFollow(root.id, !following)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ring-1 ring-foreground/10 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
              following && "bg-primary/8 text-primary ring-primary/30",
            )}
          >
            {following ? (
              <Bell className="size-3.5" aria-hidden />
            ) : (
              <BellOff className="size-3.5" aria-hidden />
            )}
            {following ? "Following" : "Follow"}
          </button>
        )
      }
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto py-2"
        role="log"
        aria-label="Thread replies"
      >
        {!root ? (
          <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
            {complete ? (
              "This thread is unavailable."
            ) : (
              <Spinner label="Loading" />
            )}
          </div>
        ) : (
          <>
            {renderMessage(root, false)}
            <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-muted-foreground">
              <span>
                {root.replyCount} {root.replyCount === 1 ? "reply" : "replies"}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {replies.map((reply, i) => {
              const previous = replies[i - 1];
              const grouped =
                previous?.kind === "message" &&
                reply.kind === "message" &&
                previous.authorUserId === reply.authorUserId &&
                previous.authorAgentId === reply.authorAgentId &&
                reply.createdAt - previous.createdAt < 5 * 60_000;
              return <div key={reply.id}>{renderMessage(reply, grouped)}</div>;
            })}
            <div ref={end} />
          </>
        )}
      </div>
      {composer}
    </Panel>
  );
}

type SearchResult = {
  channelId: string;
  channelName: string | null;
  snippet: string;
  message: {
    id: string;
    threadRootId: string | null;
    createdAt: string;
    author: { name: string };
  };
};

export function SearchPanel({
  channel,
  onClose,
  onOpen,
}: {
  channel?: Channel;
  onClose: () => void;
  onOpen: (result: SearchResult) => void;
}) {
  const { organization } = useWorkspace();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    | { type: "idle" }
    | { type: "loading" }
    | { type: "done"; results: SearchResult[] }
    | { type: "error"; message: string }
  >({ type: "idle" });
  const run = useDebouncedCallback((text: string) => {
    if (!text.trim()) {
      setState({ type: "idle" });
      return;
    }
    setState({ type: "loading" });
    callCapability<{ results: SearchResult[] }>("searchChannelMessages", {
      organizationId: organization.id,
      query: text.trim(),
      ...(channel ? { channelId: channel.id } : {}),
    })
      .then((r) => setState({ type: "done", results: r.results }))
      .catch((e: unknown) =>
        setState({
          type: "error",
          message: e instanceof Error ? e.message : "Search failed.",
        }),
      );
  }, 250);
  return (
    <Panel
      title="Search"
      subtitle={
        channel?.name ? `In #${channel.name}` : "In channels you can read"
      }
      onClose={onClose}
    >
      <div className="border-b p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            type="search"
            aria-label="Search messages"
            placeholder='Words, "a phrase", -exclude'
            value={query}
            className="h-9 pl-9 text-[14px]"
            onChange={(e) => {
              setQuery(e.target.value);
              run(e.target.value);
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state.type === "loading" && (
          <div className="grid place-items-center py-8">
            <Spinner label="Loading" />
          </div>
        )}
        {state.type === "error" && (
          <p role="alert" className="p-3 text-[13px] text-destructive">
            {state.message}
          </p>
        )}
        {state.type === "done" && !state.results.length && (
          <p className="p-3 text-[13px] text-muted-foreground">
            No messages match.
          </p>
        )}
        {state.type === "done" && (
          <ul className="space-y-1">
            {state.results.map((r) => (
              <li key={r.message.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="w-full rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span className="flex items-baseline gap-1.5 text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {r.message.author.name}
                    </span>
                    {r.channelName && <span>#{r.channelName}</span>}
                    <span className="ml-auto tabular-nums">
                      {formatTime(Date.parse(r.message.createdAt))}
                    </span>
                  </span>
                  <Snippet text={r.snippet} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// PostgreSQL marks matches with « »; render them as highlights (as text,
// never as HTML).
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span className="mt-0.5 line-clamp-3 block text-[13px]">
      {parts.map((part, i) =>
        part.startsWith("«") && part.endsWith("»") ? (
          <mark
            key={i}
            className="rounded bg-amber-400/30 px-0.5 text-foreground"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  );
}

export type { SearchResult };
