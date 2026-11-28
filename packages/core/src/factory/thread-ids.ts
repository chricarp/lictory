import { createHash } from "node:crypto";

// Stable ids of what the Factory writes into a session's thread (its card,
// approval cards, the agent's replies), so every write is idempotent: a
// retried publish, a replayed hook or a second worker finds the message it
// already wrote by its primary key.

export function stableId(...parts: string[]) {
  const h = createHash("sha256")
    .update(`factory-thread:${parts.join(":")}`)
    .digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// The live card of a session. A session started in a channel without a
// thread (the dispatcher's reporting channel) takes its card as the thread.
export const sessionCardId = (sessionId: string) =>
  stableId("session", sessionId);
