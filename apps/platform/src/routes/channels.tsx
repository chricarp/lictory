// Lictory Channels routes: /{org}/channels (the channel browser) and
// /{org}/channels/{channel} (one conversation, `?thread=` and `?message=`).
// Data comes from the Channels Zero subscriptions, never a loader.

export { ChannelBrowser as ChannelsRoute } from "@lictory/platform/components/channels/browser";
export { ChannelConversation as ChannelRoute } from "@lictory/platform/components/channels/conversation";
