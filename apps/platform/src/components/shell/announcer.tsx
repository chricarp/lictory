import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// One polite live region for the workspace. Screen reader users hear what
// changes while they work (a new message in the open conversation, an
// agent's request, a session finishing, an approval, a check failing)
// without leaving their place. Every realtime announcement goes through
// it, so they queue instead of interrupting one another.
//
// Announce what others (people, agents, checks) changed. A person's own
// actions are confirmed where they acted (a toast, the control's new
// state); announcing them here would say it twice.
//
// An announcement with a `key` is made once per page load: a duplicate
// event, a reconnect replaying rows, or two surfaces showing the same
// session never repeat it.

type Announce = (message: string, options?: { key?: string }) => void;

const AnnouncerContext = createContext<Announce>(() => undefined);

// How long an announcement stays in the region. Long enough for a screen
// reader to pick it up; removed afterwards so the region never grows.
const KEEP_MS = 7000;
const MAX_LENGTH = 240;
const REMEMBERED_KEYS = 500;

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<{ id: number; text: string }[]>([]);
  const next = useRef(0);
  const announced = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const announce = useCallback<Announce>((message, options) => {
    const text = clip(message.replace(/\s+/g, " ").trim());
    if (!text) return;
    const key = options?.key;
    if (key) {
      if (announced.current.has(key)) return;
      announced.current.add(key);
      if (announced.current.size > REMEMBERED_KEYS) {
        const oldest = announced.current.values().next().value;
        if (oldest !== undefined) announced.current.delete(oldest);
      }
    }
    const id = next.current++;
    setEntries((list) => [...list, { id, text }]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setEntries((list) => list.filter((entry) => entry.id !== id));
    }, KEEP_MS);
    timers.current.add(timer);
  }, []);
  return (
    <AnnouncerContext value={announce}>
      {children}
      {/* Additions are read; removals are not. Each announcement is its
          own node, so a repeated text is still heard. */}
      <div
        aria-live="polite"
        aria-relevant="additions"
        data-announcer
        className="sr-only"
      >
        {entries.map((entry) => (
          <p key={entry.id}>{entry.text}</p>
        ))}
      </div>
    </AnnouncerContext>
  );
}

export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}

// Announces how `value` changed, skipping the first value seen (what was
// already there when the page opened is not news). `value` is compared by
// identity: pass a primitive (a status, a count, a joined signature).
// `describe` returns what to say, or null when the change is not worth
// announcing; `key` scopes the value (another item or session starts over).
// Outside the shell (a gallery) nothing is announced.
export function useAnnounceChange<T>(
  key: string | null | undefined,
  value: T | undefined,
  describe: (previous: T, next: T) => string | null,
  // For a value gathered from sources that load separately (no single
  // "loaded" moment): changes this soon after the first value are still
  // the page loading, not news.
  { settleMs = 0 }: { settleMs?: number } = {},
) {
  const announce = useAnnounce();
  const seen = useRef<{ key: string; value: T; since: number } | null>(null);
  const describeRef = useRef(describe);
  useEffect(() => {
    describeRef.current = describe;
  });
  useEffect(() => {
    if (!key || value === undefined) return;
    const previous = seen.current;
    const now = Date.now();
    if (previous?.key !== key) {
      seen.current = { key, value, since: now };
      return;
    }
    seen.current = { key, value, since: previous.since };
    if (now - previous.since < settleMs) return;
    const text = describeRef.current(previous.value, value);
    if (text) announce(text);
  }, [key, value, announce, settleMs]);
}

function clip(text: string) {
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

// Plain words for an announcement from a message's Markdown: marks,
// links' targets and code fences dropped, mentions and references kept.
export function speakable(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
