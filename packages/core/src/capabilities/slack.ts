import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import { defaultSlackClient } from "@lictory/core/channels/slack/api";
import {
  disconnectSlack,
  readSlackConnection,
  saveSlackApp,
  startSlackInstall,
} from "@lictory/core/channels/slack/installation";
import {
  BACKFILL_MAX,
  linkSlackChannel,
  listSlackChannels,
  unlinkSlackChannel,
} from "@lictory/core/channels/slack/links";
import { retryChannelMirror } from "@lictory/core/channels/slack/outbound";
import { setSlackIntelligenceReads } from "@lictory/core/channels/slack/ai-access";

// Slack, the first chat system Lictory Channels sync with
// (docs/internals/channels.md#slack). The app's credentials and the install
// are an organization administrator's acts in the browser: secrets never
// pass through an agent's transcript. Linking sends a conversation to Slack,
// so it is a person's decision; agents only link when their person asked.

const getSlackConnection = defineCapability({
  name: "getSlackConnection",
  title: "Slack connection",
  description:
    "Whether the organization is connected to a Slack workspace (`status`: none, pending, connected, invalid, disconnected), which workspace, the last error and how many channels are linked. Organization administrators also get the Slack app manifest for this installation and its URLs.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    readSlackConnection(ctx.db, ctx.principal.userId, input.organizationId),
});

const saveSlackAppCapability = defineCapability({
  name: "saveSlackApp",
  title: "Save Slack app",
  description:
    "Organization administrators: save the credentials of the Slack app created from Lictory's manifest (App ID, Client ID, Client Secret, Signing Secret from its Basic Information page). They are stored encrypted and never shown again.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Organization settings → Integrations → Slack",
  },
  input: z.object({
    organizationId,
    appId: z.string().trim().min(1).max(40),
    clientId: z.string().trim().min(1).max(60),
    clientSecret: z.string().trim().min(1).max(200),
    signingSecret: z.string().trim().min(1).max(200),
  }),
  run: (ctx, input) => saveSlackApp(ctx.db, ctx.principal.userId, input),
});

const startSlackInstallCapability = defineCapability({
  name: "startSlackInstall",
  title: "Install Slack app",
  description:
    "Organization administrators: start installing the saved Slack app in a workspace. Returns the Slack page to open; Slack sends the person back to Lictory, which stores the bot token encrypted.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Organization settings → Integrations → Slack",
  },
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    startSlackInstall(ctx.db, ctx.principal.userId, input.organizationId),
});

const disconnectSlackCapability = defineCapability({
  name: "disconnectSlack",
  title: "Disconnect Slack",
  description:
    "Organization administrators: revoke Lictory's Slack token and unlink every channel. Messages stay on both sides; the app's credentials are kept so it can be installed again.",
  kind: "command",
  surfaces: webOnly,
  destructive: true,
  external: true,
  humanOnly: {
    reason: "credentials",
    where: "Organization settings → Integrations → Slack",
  },
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    disconnectSlack(
      ctx.db,
      defaultSlackClient(),
      ctx.principal.userId,
      input.organizationId,
    ),
});

const listSlackChannelsCapability = defineCapability({
  name: "listSlackChannels",
  title: "List Slack channels",
  description:
    "Slack channels the Lictory app has been invited to, with whether each is already linked to a Lictory channel. Invite the app in Slack (/invite @Lictory) to see a channel here.",
  kind: "query",
  surfaces: everywhere,
  external: true,
  input: z.object({ organizationId }),
  run: (ctx, input) =>
    listSlackChannels(
      ctx.db,
      defaultSlackClient(),
      ctx.principal.userId,
      input.organizationId,
    ),
});

const linkSlackChannelCapability = defineCapability({
  name: "linkSlackChannel",
  title: "Link channel to Slack",
  description: `Link a Lictory channel you manage (public or private, not direct) to a Slack channel the Lictory app is in (\`slackChannelId\` from listSlackChannels): from then on both sides see the same conversation. Public channels link to public Slack channels and private ones to private ones. \`backfill\` imports up to ${BACKFILL_MAX} of the Slack channel's latest messages once. Messages stay owned by the side they were written on. Linking shares the conversation with Slack: only call this when the person explicitly asked.`,
  kind: "command",
  surfaces: everywhere,
  external: true,
  idempotent: true,
  decision: true,
  input: z.object({
    organizationId,
    channelId: id,
    slackChannelId: z
      .string()
      .regex(/^[CG][A-Z0-9]{2,20}$/, "A Slack channel id starts with C or G.")
      .describe(
        "The Slack channel's id (listSlackChannels), such as C0123ABCD.",
      ),
    backfill: z
      .number()
      .int()
      .min(0)
      .max(BACKFILL_MAX)
      .default(0)
      .describe(
        "How many of the Slack channel's latest messages to import once.",
      ),
  }),
  run: (ctx, input) =>
    linkSlackChannel(ctx.db, defaultSlackClient(), ctx.principal.userId, input),
});

const unlinkSlackChannelCapability = defineCapability({
  name: "unlinkSlackChannel",
  title: "Unlink channel from Slack",
  description:
    "Stop syncing a Lictory channel with its Slack channel. Both keep their history; nothing more is sent either way.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, channelId: id }),
  run: (ctx, input) => unlinkSlackChannel(ctx.db, ctx.principal.userId, input),
});

const retrySlackMessage = defineCapability({
  name: "retrySlackMessage",
  title: "Retry sending to Slack",
  description:
    "Send again a message of a linked channel that could not reach Slack (your own, or any when you manage the channel).",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, channelId: id, messageId: id }),
  run: (ctx, input) => retryChannelMirror(ctx.db, ctx.principal.userId, input),
});

const setSlackIntelligenceReadsCapability = defineCapability({
  name: "setSlackIntelligenceReads",
  title: "Let Lictory Intelligence read Slack messages",
  description:
    "Organization administrators: allow (or stop) Lictory Intelligence reading messages written in Slack, when the AI policy is on. Off by default: until then Slack messages are withheld from Litto and other AI features.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "sharing",
    where: "Organization settings → Integrations → Slack",
  },
  input: z.object({ organizationId, allowed: z.boolean() }),
  run: (ctx, input) =>
    setSlackIntelligenceReads(ctx.db, ctx.principal.userId, input),
});

export const slackCapabilities = [
  getSlackConnection,
  saveSlackAppCapability,
  startSlackInstallCapability,
  disconnectSlackCapability,
  listSlackChannelsCapability,
  linkSlackChannelCapability,
  unlinkSlackChannelCapability,
  retrySlackMessage,
  setSlackIntelligenceReadsCapability,
] as AnyCapability[];
