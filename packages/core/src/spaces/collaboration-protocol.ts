// What the collaboration service and the browser editor agree on, without
// any server dependency so the platform bundle can import it.

// Why the service closes a draft connection (the close reason the provider
// reports). Short, without content; the editor shows them and, for
// `replaced`, reopens the page's current draft.
export const CLOSE_REASONS = {
  signedOut: "Sign in again to edit this page.",
  noAccess: "You do not have access to this page.",
  revoked: "You no longer have access to this page.",
  replaced: "This draft was closed or replaced. Reopen the page.",
} as const;

// Stateless messages telling editors the last stored sequence of their
// draft epoch, the cut `commitDraft` seals (`expectedSequence`). Sent to
// every editor after each stored batch and to an editor when it connects;
// an editor may ask again with `{ "type": "lictory.draft.sequence" }`.
export const DRAFT_STORED_MESSAGE = "lictory.draft.stored";
export const DRAFT_SEQUENCE_REQUEST = "lictory.draft.sequence";
export const draftStoredPayload = (sequence: number) =>
  JSON.stringify({ type: DRAFT_STORED_MESSAGE, sequence });

// The stored sequence a stateless payload announces, or null for anything
// else (other messages, malformed JSON).
export function storedSequenceOf(payload: string): number | null {
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  const { type, sequence } = message as { type?: unknown; sequence?: unknown };
  return type === DRAFT_STORED_MESSAGE &&
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    sequence >= 0
    ? sequence
    : null;
}
