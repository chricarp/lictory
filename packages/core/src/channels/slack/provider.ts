import type { ChatProvider } from "@lictory/core/channels/chat-provider";
import { defaultSlackClient } from "@lictory/core/channels/slack/api";
import {
  processSlackBackfills,
  processSlackEvents,
  receiveSlackRequest,
} from "@lictory/core/channels/slack/inbound";
import { processChannelMirrors } from "@lictory/core/channels/slack/outbound";

// Slack as a ChatProvider (docs/internals/channels.md#slack): what the API's
// Slack routes and the worker's `slack` job call.
export const slackChatProvider: ChatProvider = {
  id: "slack",
  receive: (db, request) => receiveSlackRequest(db, request),
  async processInbound(db, { limit, signal }) {
    const client = defaultSlackClient(signal);
    const events = await processSlackEvents(db, client, { limit, signal });
    const backfills = await processSlackBackfills(db, client, { signal });
    return {
      claimed: events.claimed,
      processed: events.processed,
      retried: events.retried,
      failed: events.failed,
      imported: backfills.imported,
    };
  },
  async processOutbound(db, { limit, signal }) {
    const mirrors = await processChannelMirrors(
      db,
      defaultSlackClient(signal),
      {
        limit,
        signal,
      },
    );
    return { ...mirrors };
  },
};
