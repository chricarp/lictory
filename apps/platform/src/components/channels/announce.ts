import { useEffect, useRef } from "react";
import type { MessageRow } from "@lictory/platform/components/channels/data";
import {
  speakable,
  useAnnounce,
} from "@lictory/platform/components/shell/announcer";

// What a new message in the open conversation sounds like: "Forge: Tests
// pass, opening the pull request". Null for what is not someone speaking:
// the person's own messages (they just sent them), system lines, cards
// (a session's card announces its own state) and deleted messages.
export function messageAnnouncement(
  message: MessageRow,
  userId: string,
  speakerOf: (message: MessageRow) => string,
): string | null {
  if (message.kind !== "message" || message.deletedAt) return null;
  if (message.authorKind === "user" && message.authorUserId === userId)
    return null;
  const text = speakable(message.body);
  const files =
    message.attachments.length + (message.externalFiles?.length ?? 0);
  const said =
    text ||
    (files ? `shared ${files === 1 ? "a file" : `${files} files`}` : "");
  if (!said) return null;
  return `${speakerOf(message)}: ${said}`;
}

// Announces messages that arrive in the open conversation (or thread)
// after it opened. Older messages loaded by scrolling up, and the ones
// already there once the conversation finished loading (`ready`), are not
// news.
export function useAnnounceMessages(
  conversationKey: string,
  messages: readonly MessageRow[],
  ready: boolean,
  userId: string,
  speakerOf: (message: MessageRow) => string,
) {
  const announce = useAnnounce();
  const newest = useRef<{ key: string; sequence: number } | null>(null);
  const speaker = useRef(speakerOf);
  useEffect(() => {
    speaker.current = speakerOf;
  });
  useEffect(() => {
    if (!ready) return;
    const latest = Math.max(0, ...messages.map((m) => m.sequence));
    const seen = newest.current;
    newest.current = {
      key: conversationKey,
      sequence: Math.max(
        latest,
        seen?.key === conversationKey ? seen.sequence : 0,
      ),
    };
    if (seen?.key !== conversationKey) return;
    for (const message of messages) {
      if (message.sequence <= seen.sequence) continue;
      const text = messageAnnouncement(message, userId, speaker.current);
      if (text) announce(text, { key: `message:${message.id}` });
    }
  }, [conversationKey, messages, ready, userId, announce]);
}
