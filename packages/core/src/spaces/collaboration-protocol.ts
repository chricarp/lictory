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

// Why the service refused to store an editor's change (the close reason of
// that draft's connection; the socket stays open). Unlike a database failure,
// which resets the socket and is retried by reconnecting, these leave the
// change unstored until the editor offers it again, so the editor shows that
// saving failed. Short, without content.
export const SAVE_REFUSALS = {
  tooLarge: "This change is too large to save at once.",
  unreadable: "This change could not be read.",
  cannotEdit: "You can no longer edit this page.",
  draftGone: "This draft is no longer available.",
} as const;

// The refusal a close reason names, or null for any other reason.
export function saveRefusalOf(reason: string | undefined): string | null {
  return Object.values(SAVE_REFUSALS).find((text) => text === reason) ?? null;
}

// The largest single change the service stores (`SAVE_REFUSALS.tooLarge`).
export const DRAFT_UPDATE_BYTES = 512 * 1024;

// How an editor's provider addresses its draft: each session under a key of
// its own on the shared socket (`<document name>\0<session id>`). The
// service queues messages that reach a closed draft and applies and
// acknowledges them when that address opens again, so with one key per
// draft a session would be acknowledged what an earlier one sent, and read
// "Saved" too early.
export const draftProviderOptions = { sessionAwareness: true } as const;

// The part of a Hocuspocus provider `stopSendingDraft` uses.
type DraftProvider = {
  readonly effectiveName: string;
  configuration: {
    websocketProvider: {
      configuration: { providerMap: Map<string, unknown> };
    };
  };
  detach(): void;
};

// After a refusal: stops the provider sending for its draft without a close
// message (the service would only queue what arrives for the closed draft,
// until the socket closes). The provider's document keeps every edit.
export function stopSendingDraft(provider: DraftProvider) {
  const providers =
    provider.configuration.websocketProvider.configuration.providerMap;
  if (providers.get(provider.effectiveName) === provider)
    providers.delete(provider.effectiveName);
  provider.detach();
}

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
