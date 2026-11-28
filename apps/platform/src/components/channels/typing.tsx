import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  TYPING_TTL,
  announceTyping,
  subscribeTyping,
  typingIn,
} from "@lictory/platform/data/signals";

// Typing indicators through the workspace's event stream (never stored):
// the composer says "typing" at most every few seconds while someone writes;
// the server forwards it only to people who can read the channel.

const ANNOUNCE_EVERY = 3_000;

/** A callback for the composer: announces typing, throttled. */
export function useAnnounceTyping(channelId: string) {
  const { organization } = useWorkspace();
  const last = useRef(0);
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < ANNOUNCE_EVERY) return;
    last.current = now;
    void announceTyping(organization.id, channelId);
  }, [organization.id, channelId]);
}

export function TypingIndicator({ channelId }: { channelId: string }) {
  const { organization, memberName } = useWorkspace();
  const [typists, setTypists] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setTypists(typingIn(organization.id, channelId));
    const unsubscribe = subscribeTyping(organization.id, update);
    // Entries expire on their own.
    const timer = window.setInterval(update, TYPING_TTL / 3);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [organization.id, channelId]);
  const names = typists.map((id) => memberName(id));
  const text =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : "Several people are typing…";
  // Not announced: the message itself is, when it arrives (see the
  // workspace's announcer); typing would only interrupt.
  return (
    <p className="h-4 truncate px-5 text-xs leading-4 text-muted-foreground sm:px-6">
      {text}
    </p>
  );
}
