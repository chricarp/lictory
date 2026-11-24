-- Lictory Channels, replicated by Zero (an expand: the previous release
-- neither reads nor writes these tables). Channel rows, memberships with
-- their read cursors, messages, reactions, thread participation and
-- promotion links are shaped for synchronization: every Channels query
-- authorizes through organization membership and channel access (public
-- channels for organization members, private and direct ones for their
-- members). Message revisions and resolved mentions stay server-side. Never
-- add credentials, sessions, tokens or private configuration here.
ALTER PUBLICATION "lictory_zero" ADD TABLE
  "channel",
  "channel_member",
  "channel_message",
  "channel_reaction",
  "channel_thread_participant",
  "channel_promotion";
