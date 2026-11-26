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
| `channel_external_link`      | A channel's link to a Slack channel: its name, URL and health (history kept after unlinking)                | yes                |
| `channel_mirror`             | The outbox and mapping of Lictory messages and reactions sent to a linked Slack channel                     | failures only      |

Slack's own state (`slack_installation` with its encrypted credentials,
`slack_event`, the verified Events API inbox, and `slack_user`, Slack people
as Lictory last saw them) is server-only; see [Slack](#slack).

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
agent ids and handles, naming the agent an authenticated call executes as
(from the token's agent scope), and two in-transaction hooks: `mentioned`
when a message mentions agents and `replied` for every thread reply. The
Factory registers it: a mention by a person who may use the agent starts a
session whose thread is the message's thread, and a reply by the session's
requester or the agent's owner steers it; see
[sessions in channels](factory.md#sessions-in-channels). The hooks only
write rows (sessions, inputs, cards) in the message's transaction; the
events say who wrote the message and whether through an agent or a token,
because only a person's own words start or steer work. With no directory registered, agents are
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
participation, the message's notification event and, in channels linked to
Slack, the message's `channel_mirror` outbox row. Lictory's own writes go
through it as well: system lines and cards (`appendSystemMessage`, idempotent
with a stable id), a card's live payload (`updateCardPayload`, in place,
because a card is Lictory's state rather than anyone's words; a new body is
mirrored again) and an agent session's posts (`postAgentMessage`, authored by
the agent on behalf of its owner, idempotent by id, mirrored like any
Lictory message).

Messages from a linked Slack channel go through the same writer, with the
same locks and counters, but without an actor: the authority is the
verified delivery of the organization's Slack installation and the
channel's active link to the Slack channel it names. A mapped author is
re-checked as an organization member who can read the channel; anyone else
is an external author with no permissions (see [Slack](#slack)). Everything else about a
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

## Slack

Slack is the first `ChatProvider` (`packages/core/src/channels/slack/`). It
exists so a team can adopt Lictory Channels without leaving Slack on day one:
a channel is linked to a Slack channel, both sides see one conversation, and
the link is removed later to consolidate.

### Ownership

A message is owned by the system it was written in.

- Rows written in Slack carry `external_source = 'slack'` and the Slack
  message `ts` as `external_id`. Only the Slack ingest edits or deletes them
  (`appendExternalMessage`, `applyExternalEdit`, `applyExternalDelete` in the
  conversation writer); Lictory's own edit and delete refuse them with kind
  `external_owner`, for everyone, administrators included. They stay owned by
  Slack after unlinking.
- Rows written in Lictory never carry `external_source`. Their Slack copy is
  the `channel_mirror` row's `external_id`. An edit or deletion in Slack of
  such a copy (only Lictory's bot can make one) is ignored.
- Nothing is synchronized in both directions for the same message. Reactions
  are owned per reaction: a Slack person's reaction is stored with
  `channel_reaction.external_source = 'slack'` (when they map to a member) or
  counted by name in `channel_message.external_reactions` (when they do not),
  and is never mirrored back; a Lictory reaction is mirrored as the bot's.

### Connection

One Slack app per organization, created by an administrator from a manifest
Lictory generates (`slackAppManifest`: bot scopes, bot events, the Events
API, interactivity and OAuth redirect URLs of this installation). Each
installation is the customer's own internal app; Lictory never distributes
one app to several workspaces. The app's client secret and signing secret,
and the bot token from the OAuth v2 install, are encrypted with the delivery
credentials key bound to the organization and never returned; saving and
installing are web-only capabilities (`humanOnly: credentials`). The install
`state` is a random value whose hash, person and ten-minute expiry are
stored; the callback needs the same signed-in administrator. Saving first
asks Slack about the Client ID and Secret, outside any transaction: no token
exists yet, so the check is `oauth.v2.access` with a made-up code, which Slack
answers `invalid_code` only when the client credentials are right. The signing
secret has no such check; Slack's events URL verification proves it.

`slack_installation.status` moves as a consequence: `pending` (credentials
saved), `connected` (installed), `invalid` (Slack refused the token, the app
was uninstalled or its token revoked: links are marked failing until an
administrator reinstalls) and `disconnected` (an administrator disconnected:
the token is revoked and forgotten, every channel unlinked, the app's
credentials kept). Installing in another workspace while channels are linked
is refused.

### Linking

A person who manages a Lictory channel links it to a Slack channel the
Lictory app is in (`linkSlackChannel`, a `decision`: agents link only when
their person asked). Public links only to public and private only to
private, so linking never widens who reads a conversation; direct
conversations are never linked. The link row and `channel.external_source`
/ `external_id` are written together under the exclusive organization lock,
with a system line and an `audit_event` (`slack.channel_linked`). An
optional backfill imports at most 200 of the latest Slack messages (and the
replies of their latest threads) once, oldest first, through the same ingest;
it is bounded and asked for by a person, never a bulk export. Unlinking
clears the channel's external fields, keeps the link row with
`unlinked_at`, stops queued sends and leaves both histories intact.

### Inbound

`POST /api/slack/events/{organizationId}` verifies `X-Slack-Signature` with
that organization's signing secret: `v0=` and the HMAC-SHA256 of
`v0:{timestamp}:{raw body}`, compared in constant time, refused when the
timestamp is more than five minutes away (`signature.ts`). The URL
verification challenge is answered only when signed. A verified
`event_callback` must name the organization's app (`api_app_id`) and its
installed workspace (`team_id`); then it is stored once in `slack_event`
(unique by installation and Slack's `event_id`, so Slack's retries and
replays inside the window store nothing new) and answered at once, within
Slack's three seconds. Routing by organization in the URL plus that
organization's secret is the tenant boundary: a delivery signed for one
installation fails verification at another's URL, and processing only
writes into channels of the event's organization linked to the Slack channel
it names.

The worker's `slack` job claims due events under a lease (fenced by the
attempt) and processes them through the conversation writer:

- `message` (and `thread_broadcast`, `file_share`, `bot_message`): appended,
  idempotent by Slack `ts`; a reply joins the thread of the message its
  `thread_ts` names (a Slack message or a Lictory message's Slack copy).
- `message_changed` / `message_deleted`: an edit keeps the previous body as
  a revision; a deletion leaves a tombstone. Messages Lictory owns are
  ignored. An edit, deletion or reaction for a message not processed yet
  waits a few attempts before it is dropped.
- `reaction_added` / `reaction_removed`, `channel_rename`, the app leaving
  or the channel being archived (link failing), `app_uninstalled` and
  `tokens_revoked` (installation invalid).
- Files are stored as name, type, size and Slack permalink
  (`external_files`); Slack keeps checking who may open them. Downloading
  them into Lictory storage is not implemented.

Loop prevention: events caused by Lictory's own bot (its `bot_id`, bot user,
app id, or the `lictory_message` metadata of its posts) are never ingested.

### People

A Slack person is a Lictory person only when Slack confirmed their email, a
Lictory account with that address verified it too, and that account is a
member of the organization (`people.ts`); the writer re-checks membership
and, for private channels, channel membership in its transaction. Emails are
compared, never stored. Everyone else (guests, people without an account,
bots) is written with `author_kind = 'external'` and `external_author_name`,
shown as "Name (Slack)", with no Lictory identity, notifications or
permissions. `<@U…>` mentions of mapped people become Lictory mentions (and
notify); Lictory mention tokens typed as text in Slack are broken
(`neutralizeTokens`), so Slack text can never carry one.

Text is information, never permission. A Slack `@handle` becomes an agent
mention, reaching the Factory's `mentioned` hook, only when the author maps
to a member who may address that agent (`addressableAgent`: the directory's
`mayAddress`; the Factory's is the rule for starting a session, an active
agent the person owns or a shared one). A mapped person's thread replies
steer the agent's session as in Lictory. Promotions and every other
action need a Lictory person in Lictory; nothing in Slack text starts one.

### Outbound

The conversation writer calls `queueMirror` (`channels/mirror.ts`) in its
own transaction when a Lictory-owned message is posted, edited or deleted,
when a card is appended, or when a Lictory reaction changes, in a linked
channel. It upserts one `channel_mirror` row per message (and per emoji),
bumping `version` and `due_at`; system lines stay in Lictory. The worker
claims due rows under a lease, reads the message as it is then and makes
Slack match: `chat.postMessage` with the author's name and avatar
(`chat:write.customize`; agents as "Forge (via Ada)", cards as Block Kit
summaries with an **Open in Lictory** button), `chat.update`, `chat.delete`,
`reactions.add` / `remove`. It settles only the version it sent, so an edit
made while sending is sent next. Posting is idempotent by the Lictory message
id: it travels as message metadata, and an attempt after an unanswered post
looks for it in the channel's recent history before posting again. Replies
wait for their thread root to reach Slack.

HTTP 429 waits for `Retry-After` without counting an attempt; transient
failures back off exponentially (5 s doubling, at most 10 minutes) and fail
after six attempts; a refusal (message too long, channel gone, app removed,
token revoked) fails at once. A failed row is synchronized
(`channelMirrorFailures`), so the message shows "Not sent to Slack" with the
reason and a Retry action (`retrySlackMessage`, its author or someone who
manages the channel); a channel or token error also marks the link failing,
which the header shows.

### Slack data, AI providers and Slack's terms

Lictory Intelligence reads messages written in Slack only when the
organization's AI policy is on **and** an administrator allowed it
(`setSlackIntelligenceReads`, web-only, `humanOnly: sharing`). Otherwise
`readChannel`, `readChannelThread` and `searchChannelMessages` on the
embedded agent's surface withhold their text and files (`ai-access.ts`), so
Slack content never reaches the AI provider. A person's own MCP client reads
what the person reads. Any new feature that sends channel text to an AI
provider (summaries, the Factory's built-in harness) must apply
`intelligenceMayReadSlack` to Slack-written rows. The Factory does for the
thread it quotes when a mention starts a session; the mention (and a
steering reply) is the mapped person's own request to that agent and is
sent as written.

Lictory uses Slack's API as an internal app of the customer's workspace:
only channels the app was invited to, only the bounded backfill a person
asked for, no bulk export of history and no Slack data in data exports
beyond the messages synchronized into Lictory.

### Health and retention

The header reads `channel_external_link.health` ("Synced with #x in Slack",
red when failing, with the last error). Processed Slack events are kept a
week and failed ones a month (`slack-prune`).

### Contracts for other modules

- `AgentDirectory.mayAddress` (Factory, `factory/loop.ts`): whether a
  person may address an agent: active, and owned by the person or shared.
- `queueMirror` is provider-agnostic; a second `ChatProvider` adds its own
  worker and keeps the same rows.

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

Typing indicators, per-channel retention, downloading Slack files into
Lictory storage and a message edit history view are not implemented yet.
Agents autocomplete in the composer next to people and are written as
`@[handle](agent:ID)`.
