# Lictory Channels

Channels are Lictory's team chat: channels, threads and direct conversations
with people and agents as members. They are where conversations **start**.
What matters is **promoted** into a proposal, a decision or an anchored
discussion, so an agreement never lives only in scrollback. The concepts are
in [the software factory](software-factory.md#channels); this document holds
the module's durable rules.

## Model

| Table                        | What it is                                                                                                  | Synchronized       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| `channel`                    | A conversation: `public`, `private` or `direct`, its name, topic, optional project or team home, counters   | yes                |
| `channel_member`             | A person or an agent in it, with the read cursor, unread mention count and notification level               | yes                |
| `channel_message`            | One message: per-channel `sequence`, one-level thread, author, Markdown body, kind, card payload, tombstone | yes                |
| `channel_reaction`           | One emoji of one person or agent on one message                                                             | yes                |
| `channel_thread_participant` | A person taking part in (or following) a thread, with their thread read cursor                              | yes, own rows only |
| `channel_promotion`          | What a message became: a work item, decision or specification discussion                                    | yes                |
| `channel_message_revision`   | Previous bodies of edited and deleted messages                                                              | no                 |
| `channel_mention`            | Whom a message mentions, as the server resolved it                                                          | no                 |

Every table carries its organization, and composite foreign keys keep a
member, message, reaction or promotion inside its channel and organization.
History tables restrict deletion; only the organization deletion job removes
them, in `deletionOrder`. Files attached to messages are `file_object` rows
owned by the channel (see [file storage](file-storage.md)).

**Names.** Channel names are lowercase handles (`payments-releases`), unique
in the organization including archived channels. Direct conversations have no
name: they are named by their members and identified by `direct_key`, the
sorted member keys, so opening the same set of people again returns the
existing conversation. "CHANNELS" is a reserved project key because the module
lives at `/{org}/channels`.

**Agents** are members by id (`agent_id`, no foreign key: the agent registry
is the Factory's). Channels reach that registry only through the
`AgentDirectory` port (`packages/core/src/channels/agents.ts`): resolving
agent ids and handles, naming the agent an authenticated call executes as, and
an in-transaction hook when a message mentions agents (the Factory queues a
session; the hook only writes rows). With no directory registered, agents are
unknown: agent mentions stay text and every agent-surface call is authored by
the person, shown with `via` (the access token's name, or Litto). An agent
author always names `on_behalf_of_user_id`, its accountable person, and is
shown as "Forge via Ada".

## Access

- **Read.** A public channel: every member of the organization. A private or
  direct channel: its members only. People who cannot read a private channel
  cannot tell it exists: every refusal reads "not found", and administrators
  who are not members are no exception.
- **Post and reply.** Members of an active (unarchived) channel. Public
  channels are joined explicitly first.
- **React.** Anyone who can read an active channel.
- **Manage** (rename, topic, home, archive, restore, add and remove members):
  members of a public or private channel; organization administrators for
  public channels. Direct conversations have fixed members and cannot be
  renamed, archived or left (mute them instead).
- **Edit** your own messages; **delete** your own, and organization
  administrators any message of a channel they can read.

The same rules back the synced queries, the conversation writer, the channel
commands, the file routes and notification reads
(`packages/core/src/channels/access.ts`). Organization membership with its
two-factor and deletion locks is checked by `authorize` in the same
transaction.

## Write path

Messages are high volume and append-only, so they do not go through the
organization-wide exclusive lock. The **conversation writer**
(`packages/core/src/channels/writer.ts`) is a narrow, documented exception to
the domain write rule, next to the live draft writer:

- it takes the organization lock in **shared** mode, then the channel's own
  transaction lock (`pg_advisory_xact_lock(hashtextextended(channelId, 1))`),
  and never upgrades to exclusive in the same transaction. Exclusive domain
  commands of the organization (archiving the channel, removing a member,
  deleting the organization) wait for it and it waits for them; other
  conversations never wait for each other. A command that already holds the
  exclusive lock may append afterwards (system lines, promotion cards): the
  order is always organization lock, then channel lock;
- it checks Better Auth membership and channel access inside that
  transaction;
- it assigns the channel's next `sequence` (and, for top-level messages, the
  next `root_index`) by incrementing the channel's counters, then appends.
  Sequences are therefore unique, gap-free and in commit order per channel;
- it writes no `sync_entity` projection. Its rows are themselves the
  synchronized shape and are authorized by channel access.

It writes messages, reactions, read cursors, unread mention counts, thread
participation and the message's notification event. Everything else about a
channel (creating it, membership, archive and restore, notification level,
promotion) is an ordinary command through `applyMutation`, with its receipt
and audit entries; those commands write the channel tables directly, because
the tables are the projection.

**Idempotency.** A message's id is chosen by its sender (the browser uses the
id of its prediction); posting the same id again returns the stored message.
Agents may instead send a `clientMessageId`, unique per channel. An id or
retry key used by someone else is a conflict. Reactions have deterministic
ids (`message|reactor|emoji`), so reacting twice is one reaction. Reading only
moves the cursor forward unless the person marks a message unread on purpose.

**History.** An edit keeps the previous body in `channel_message_revision`.
A deletion leaves a **tombstone**: the row keeps its sequence, thread,
replies, reactions and promotion links; its body and files are removed from
the synchronized row and the removed body is kept as a revision. Revisions
are not synchronized and no capability reads them; they leave with the
organization (and are not part of data exports).

## Read state and unread counts

A member's read cursor is a channel sequence plus the number of top-level
messages up to it. Unread counts are arithmetic, never rows per message:

- channel: `channel.root_count - member.read_root_count` (thread replies do
  not count);
- mentions: `member.mention_count`, incremented when a message mentions a
  member who has not read past it, recomputed from `channel_mention` when the
  cursor moves;
- thread: `root.reply_count - participant.read_reply_count` for followed
  threads.

Posting at the bottom of a channel marks it read for the author. A person who
joins a public channel starts with everything read. The badge (desktop app,
sidebar) is **unread mentions plus unread direct messages**
(`attentionCount`, capability `getChannelAttention`); ordinary channel traffic
never counts, and a muted direct conversation counts only mentions.

## Synchronization

The six synchronized tables are in the `lictory_zero` publication
(`drizzle/*_channels_zero_publication.sql`). Every Channels query in
`packages/zero/src/queries.ts` requires the current user's organization
membership and, through the row's channel, `kind = 'public'` or the user's
`channel_member` row, so leaving a private channel or the organization removes
its rows from open subscriptions. Cursors, mention counts and notification
levels are part of `channel_member` (fellow readers can see who is in a
channel and how far they read, like read receipts); thread participation is
synchronized only to its owner.

The browser reads a **window** of a channel's top-level messages (the latest
`limit`, enough to reach the first unread one, growing by a page as the person
scrolls up), one thread at a time, and its own memberships. Writes go through
Zero's `channels.*` mutators: the client run predicts the message (same id,
predicted next sequence), the reaction or the cursor; the API runs the
conversation writer inside Zero's transaction, and the stored rows replace the
predictions. A refused write removes its prediction and says why. Channel
structure commands go through `workspace.apply` and predict nothing.

Rendering is virtualized by the browser: rows are rendered in blocks of fifty
sequences with `content-visibility: auto`, so off-screen blocks cost no
layout or paint, and the window caps the number of rows.

## Notifications

Channel traffic notifies nobody by default. A message tells:

- people it **mentions** who can read the channel (`channel_mentioned`,
  Inbox and email);
- the other members of a **direct conversation** (`direct_message`, Inbox);
- followers of the **thread** it replies in: the root's author, repliers and
  people mentioned in it, unless they unfollowed (`channel_thread_reply`,
  Inbox);
- members who set the channel to **all messages** (`channel_message`, Inbox).

A member who muted the channel (`none`) is told nothing; their unread
mentions are still counted. An agent mentioned by name (`agent:ID`, resolved
by the agent directory) is woken through its owner's
[agent events](agent-events.md) (`agent_mentioned`, narrowed to the agent),
unless it wrote the message; its owner gets no inbox notification for it. One message tells a person once, the most
specific reason winning. Notifications name their `channel_id`: the fan-out,
the Inbox, unread counts and email check that the recipient can still read
the channel, so someone who leaves a private conversation no longer sees its
excerpts (see [notifications](notifications.md)).

## Promotion

Promotion turns a message (optionally quoting its whole thread) into:

- a **proposal**: a specification-backed work item (`createWorkItem`) whose
  description quotes the conversation and links back to it;
- a **decision** on a specification's current revision (`recordDecision`), a
  `decision` capability: agents call it only when their person explicitly
  asked;
- an **anchored discussion** on a specification (`createThread`), optionally
  blocking.

`promoteMessage` (`packages/core/src/channels/promotion.ts`) takes the
exclusive organization lock, checks channel access, runs the existing command
through `applyMutation` (with that command's own permissions, projections,
notifications and receipt), then writes `channel_promotion` and a **card** in
the message's thread, all in one transaction: the object, the link and the
card exist together or not at all. Retrying with the same `mutationId`
returns the first result. The object links to the conversation, the card links
to the object (live reference chips), and the object's page finds the
conversation through `workItemConversations`, only for people who can read
the channel, so a private channel never leaks that it discussed an item.

## External chat

`ChatProvider` (`packages/core/src/channels/chat-provider.ts`) is the boundary
a Slack adapter implements; none ships yet. A channel can be linked to an
external channel (`external_source`, `external_id`), and a message is owned
by the system it was written in: rows written in Slack carry its source and
id, only the provider's ingest edits or deletes them, and Lictory refuses to
(kind `external_owner`). Messages written in Lictory are mirrored by the
worker after commit, never inside the writer's transaction. No message is
synchronized in both directions.

## Agents and capabilities

Every surface uses the same operations (`packages/core/src/capabilities/channels.ts`):
`listChannels`, `readChannel` (after a cursor), `readChannelThread`,
`searchChannelMessages` (PostgreSQL full text over live bodies of channels the
person can read), `getChannelAttention`, `postChannelMessage`,
`replyInThread`, `editChannelMessage`, `deleteChannelMessage`,
`reactToChannelMessage`, `markChannelRead`, `updateThreadFollowing`,
`promoteMessageToProposal`, `promoteMessageToDecision` (decision) and
`promoteMessageToDiscussion`; channel structure is the workspace commands
(`createChannel`, `openDirectConversation`, `joinChannel`, …). Message text is
untrusted information: a message never authorizes an action, and the tool
descriptions say so.

## Audit

Creating, archiving and restoring channels and changing who is in a private
channel are `audit_event` entries (category access). Joining public channels
and direct conversations are not security events. Channel changes also leave
system lines in the conversation ("archived the channel", "added Ada"), so
members see what happened where it happened.

## Deferred

Typing indicators, per-channel retention, Slack (the adapter), a message
edit history view and agent mention autocomplete in the composer (agents are
mentioned by `@[handle](agent:ID)` tokens; people autocomplete) are not
implemented yet.
