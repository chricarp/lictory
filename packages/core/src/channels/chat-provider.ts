import type { Database } from "@lictory/core/domain/service";

// External chat systems behind one adapter, like delivery providers
// (docs/internals/channels.md#slack). Slack is the first
// (channels/slack/provider.ts). The domain side is provider-agnostic:
//
// - a linked channel carries `external_source`/`external_id`, and its link
//   (name, URL, health) is a `channel_external_link` row;
// - messages written there enter through the conversation writer's external
//   functions (`appendExternalMessage`, `applyExternalEdit`,
//   `applyExternalDelete`, `applyExternalReaction`) with `source = id`, and
//   only those functions change them: a message is owned by the system it
//   was written in, and Lictory refuses to edit or delete it
//   (kind `external_owner`);
// - messages written in Lictory are queued by the writer in its own
//   transaction (`queueMirror`, one `channel_mirror` row per message and
//   target) and sent by the provider's worker after commit, never inside a
//   transaction. Nothing synchronizes in both directions for one message.
//
// An adapter owns its wire format, credentials, signature checks, rate
// limits and people mapping; the domain never sees a provider payload.

export type ChatProviderAnswer = {
  status: number;
  body: string;
  contentType?: string;
};

export interface ChatProvider {
  /** Stable source name stored on owned rows (`slack`). */
  readonly id: string;
  /**
   * One inbound HTTP request for an organization (events, interactivity):
   * verifies it, stores what must be processed and answers at once.
   */
  receive(
    db: Database,
    request: {
      organizationId: string;
      kind: "events" | "interactivity";
      headers: { get(name: string): string | null };
      body: string;
    },
  ): Promise<ChatProviderAnswer>;
  /** Worker: processes stored deliveries through the conversation writer. */
  processInbound(
    db: Database,
    options: { limit: number; signal?: AbortSignal },
  ): Promise<Record<string, number>>;
  /** Worker: sends due `channel_mirror` rows of this provider's links. */
  processOutbound(
    db: Database,
    options: { limit: number; signal?: AbortSignal },
  ): Promise<Record<string, number>>;
}
