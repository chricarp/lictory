// External chat systems (Slack first) behind one adapter, like delivery
// providers. Not implemented yet: this is the boundary a Slack adapter
// implements, written down so the channel model already carries what it
// needs (`external_source`/`external_id` on channels and messages).
//
// Ownership rule (docs/internals/channels.md#external-chat): a message is
// owned by the system it was written in. Messages written in Slack are
// stored with `externalSource = provider.id` and their Slack id; only the
// provider's ingest edits or deletes them, and Lictory refuses to. Messages
// written in Lictory are mirrored to Slack by the worker after commit
// (never inside the conversation writer's transaction), and later edits or
// deletions in Lictory are mirrored the same way. Nothing synchronizes in
// both directions for the same message.

type ExternalChannelRef = { source: string; externalId: string };

type ExternalMessage = {
  externalId: string;
  // Thread root's external id, for replies.
  threadExternalId?: string | null;
  authorExternalId: string;
  // Markdown converted by the adapter from the provider's format.
  body: string;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
};

type ChatProviderEvent =
  | { type: "message"; channel: ExternalChannelRef; message: ExternalMessage }
  | {
      type: "message_changed";
      channel: ExternalChannelRef;
      message: ExternalMessage;
    }
  | {
      type: "message_deleted";
      channel: ExternalChannelRef;
      externalId: string;
      deletedAt: Date;
    };

export interface ChatProvider {
  /** Stable source name stored on owned rows (`slack`). */
  readonly id: string;
  /** Verifies and parses one inbound webhook delivery (signature checked). */
  parseEvent(request: {
    headers: Headers;
    body: string;
  }): Promise<ChatProviderEvent[]>;
  /** Posts a Lictory-authored message to the linked external channel. */
  postMessage(
    channel: ExternalChannelRef,
    message: {
      body: string;
      authorName: string;
      threadExternalId?: string | null;
      // Idempotency: the Lictory message id.
      messageId: string;
    },
  ): Promise<{ externalId: string }>;
  updateMessage(
    channel: ExternalChannelRef,
    externalId: string,
    body: string,
  ): Promise<void>;
  deleteMessage(channel: ExternalChannelRef, externalId: string): Promise<void>;
  /** Maps an external author to a Lictory person by verified email. */
  resolveAuthor(externalAuthorId: string): Promise<{ email: string } | null>;
}
