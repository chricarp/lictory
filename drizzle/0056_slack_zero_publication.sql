-- Linked external chat channels, replicated by Zero (an expand: the previous
-- release neither reads nor writes these tables). `channel_external_link`
-- carries a link's external name, URL and health for the channel header;
-- `channel_mirror` the outbound state of Lictory messages, read by browsers
-- only for failures (synced query `channelMirrorFailures`). Both authorize
-- through channel access like every Channels table and carry no credential:
-- Slack tokens and secrets stay in `slack_installation`, which is never
-- published.
ALTER PUBLICATION "lictory_zero" ADD TABLE
  "channel_external_link",
  "channel_mirror";
