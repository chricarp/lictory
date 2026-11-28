import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Spinner } from "@lictory/ui/spinner";
import {
  listEntries,
  type Channel,
  type ListEntry,
  type MessageRow,
} from "@lictory/platform/components/channels/data";
import { useChannelMessages } from "@lictory/platform/components/channels/store";

// A conversation's top-level messages, newest at the bottom.
//
// Data is windowed: the Zero subscription holds the latest `limit` messages
// and grows by a page when someone scrolls near the top, keeping the scroll
// position while older messages are prepended. Rendering is virtualized by
// the browser: rows are rendered in blocks with `content-visibility: auto`,
// so off-screen blocks cost neither layout nor paint, and the window caps
// how many rows exist. (Blocks rather than single rows: containment clips
// a row's hover actions at its edges.)
// At the bottom the list follows new messages and marks them read; above,
// it stays put and offers "Jump to latest".

const PAGE = 60;
const MAX_WINDOW = 1000;
const NEAR_TOP_PX = 400;
const AT_BOTTOM_PX = 48;

// The data window of a conversation: the latest messages, enough to reach
// the first unread one, growing by a page on request.
export function useMessageWindow(channel: Channel) {
  // The read position when the conversation opened: the "New" divider
  // stays where it was while the person reads.
  const [openedAt] = useState(() => ({
    readSequence: channel.member?.readSequence ?? null,
    unread: channel.unread,
  }));
  const [limit, setLimit] = useState(() =>
    Math.min(MAX_WINDOW, Math.max(PAGE, openedAt.unread + 20)),
  );
  const data = useChannelMessages(channel.id, limit);
  const more = limit < MAX_WINDOW && !data.reachedStart;
  const grow = useCallback(
    (factor: "page" | "double") =>
      setLimit((l) =>
        Math.min(MAX_WINDOW, factor === "page" ? l + PAGE : l * 2),
      ),
    [],
  );
  return { ...data, openedAt, more, grow };
}
type MessageWindow = ReturnType<typeof useMessageWindow>;

export function MessageList({
  channel,
  window: { messages, complete, reachedStart, openedAt, more, grow },
  userId,
  focusMessageId,
  renderMessage,
  onMarkRead,
  empty,
}: {
  channel: Channel;
  window: MessageWindow;
  userId: string;
  // A permalink (?message=): scroll to it and highlight it.
  focusMessageId?: string;
  renderMessage: (message: MessageRow, grouped: boolean) => ReactNode;
  onMarkRead: (sequence: number) => void;
  empty: ReactNode;
}) {
  const entries = useMemo(
    () =>
      listEntries(messages, {
        readSequence: openedAt.unread > 0 ? openedAt.readSequence : null,
        userId,
      }),
    [messages, openedAt, userId],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [unreadAbove, setUnreadAbove] = useState(false);
  // Scroll anchoring for prepends: distance from the bottom before the
  // window grew.
  const anchor = useRef<number | null>(null);
  const positioned = useRef(false);

  const lastSequence = messages.at(-1)?.sequence ?? 0;
  const markIfVisible = useCallback(() => {
    if (
      atBottom.current &&
      document.visibilityState === "visible" &&
      channel.member &&
      channel.member.readSequence < channel.lastSequence
    )
      onMarkRead(channel.lastSequence);
  }, [channel.member, channel.lastSequence, onMarkRead]);

  // Position once the first window arrived: at the "New" divider when there
  // is unread history, else at the bottom; at a permalink when given.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || positioned.current) return;
    // Cached rows render before the server answers: position on them, and
    // again once the window is complete if the target was not there yet.
    if (!messages.length && !complete) return;
    const target = focusMessageId
      ? el.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(focusMessageId)}"]`,
        )
      : el.querySelector<HTMLElement>("[data-unread-divider]");
    if (target) {
      target.scrollIntoView({ block: focusMessageId ? "center" : "start" });
      atBottom.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
      positioned.current = true;
      return;
    }
    el.scrollTop = el.scrollHeight;
    const waiting = focusMessageId !== undefined || openedAt.unread > 0;
    if (complete || !waiting) positioned.current = true;
  }, [complete, focusMessageId, entries, messages.length, openedAt.unread]);

  // Keep the reading position when older messages are prepended, follow
  // the bottom when new ones arrive there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !positioned.current) return;
    if (anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  useEffect(() => {
    markIfVisible();
  }, [lastSequence, markIfVisible]);
  useEffect(() => {
    const onVisible = () => markIfVisible();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [markIfVisible]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasAtBottom = atBottom.current;
    atBottom.current = bottom < AT_BOTTOM_PX;
    setShowLatest(bottom > el.clientHeight);
    const divider = el.querySelector<HTMLElement>("[data-unread-divider]");
    setUnreadAbove(divider ? divider.offsetTop < el.scrollTop : false);
    if (atBottom.current && !wasAtBottom) markIfVisible();
    if (
      el.scrollTop < NEAR_TOP_PX &&
      more &&
      complete &&
      anchor.current === null
    ) {
      anchor.current = el.scrollHeight - el.scrollTop;
      grow("page");
    }
  };

  // A permalink to a message outside the window grows it until it is found.
  useEffect(() => {
    if (
      focusMessageId &&
      complete &&
      more &&
      !messages.some((m) => m.id === focusMessageId)
    ) {
      positioned.current = false;
      grow("double");
    }
  }, [focusMessageId, complete, more, grow, messages]);

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  const jumpToUnread = () =>
    scroller.current
      ?.querySelector<HTMLElement>("[data-unread-divider]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto overscroll-contain"
        // Screen readers hear new messages from others as they arrive,
        // through the workspace's announcer (useAnnounceMessages): not this
        // log, which would also read older messages as they load.
        role="log"
        aria-live="off"
        aria-label={`Messages in ${channel.name ? `#${channel.name}` : "this conversation"}`}
      >
        <div className="flex min-h-full flex-col justify-end pb-2">
          {!complete && messages.length === 0 ? (
            <div className="grid flex-1 place-items-center">
              <Spinner label="Loading" />
            </div>
          ) : (
            <>
              {reachedStart ? (
                <div className="px-4 pt-6 pb-2">{empty}</div>
              ) : (
                <div className="grid h-10 place-items-center text-muted-foreground">
                  <Spinner label="Loading older messages" className="size-4" />
                </div>
              )}
              {blocks(entries).map((block) => (
                <div
                  key={block[0]!.key}
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: `auto ${block.length * 44}px`,
                  }}
                >
                  {block.map((entry) => (
                    <Row key={entry.key} entry={entry} render={renderMessage} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {unreadAbove && openedAt.unread > 0 && (
        <button
          type="button"
          onClick={jumpToUnread}
          className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground shadow-(--shadow-panel) focus-ring outline-none"
        >
          <ArrowUp className="size-3.5" aria-hidden />
          Jump to first unread
        </button>
      )}
      {showLatest && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute right-4 bottom-3 z-20 flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-[12px] font-medium shadow-(--shadow-panel) focus-ring outline-none"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function Row({
  entry,
  render,
}: {
  entry: ListEntry;
  render: (message: MessageRow, grouped: boolean) => ReactNode;
}) {
  if (entry.type === "day")
    return (
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-1.5">
        <div className="h-px flex-1 bg-border" />
        <span className="rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {entry.label}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
    );
  if (entry.type === "unread")
    return (
      <div
        data-unread-divider
        className="flex scroll-mt-10 items-center gap-2 px-4 py-1"
      >
        <div className="h-px flex-1 bg-destructive/50" />
        <span className="text-xs font-semibold text-destructive">New</span>
      </div>
    );
  return (
    <div className={cn(entry.grouped ? undefined : "mt-0.5")}>
      {render(entry.message, entry.grouped)}
    </div>
  );
}

// Rendering blocks, by message sequence (fifty sequences each), so a block
// keeps its rows whether older messages are prepended or new ones appended.
// Dividers belong to the block of the message after them.
const BLOCK_SEQUENCES = 50;
function blocks(entries: ListEntry[]) {
  const out: ListEntry[][] = [];
  let current: ListEntry[] = [];
  let currentKey: number | undefined;
  let waiting: ListEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") {
      waiting.push(entry);
      continue;
    }
    const key = Math.floor(entry.message.sequence / BLOCK_SEQUENCES);
    if (key !== currentKey && current.length) {
      out.push(current);
      current = [];
    }
    currentKey = key;
    current.push(...waiting, entry);
    waiting = [];
  }
  current.push(...waiting);
  if (current.length) out.push(current);
  return out;
}
