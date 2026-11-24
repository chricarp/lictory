import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "@lictory/core/db/auth-schema";
// Circular with domain-schema (files belong to channels; channels are homed
// in projects and teams); both only reference each other inside lazy
// foreign key callbacks.
import { project, team } from "@lictory/core/db/domain-schema";

// Lictory Channels: team chat with people and agents as members. See
// docs/internals/channels.md. Every table carries its organization and
// composite foreign keys keep a member, message or reaction inside its own
// channel and organization, so a valid id from another context can never be
// attached.
//
// The tables marked "synchronized" are in the `lictory_zero` publication and
// shaped for it: browsers read them directly, authorized by the synced
// queries through channel access (public channels for organization members,
// private and direct ones for their members). They carry no credential and
// no private configuration. Messages are written by the conversation writer
// (channels/writer.ts), every other row by ordinary commands.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const organizationId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });
const optionalActor = (name: string) =>
  text(name).references(() => user.id, { onDelete: "restrict" });
const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

// Public: every organization member can find, read and join it. Private:
// only its members see it exists. Direct: a fixed set of members (a direct
// message or a group direct message), never renamed, archived or joined.
export const channelKind = pgEnum("channel_kind", [
  "public",
  "private",
  "direct",
]);
export const channelMemberKind = pgEnum("channel_member_kind", [
  "user",
  "agent",
]);
// What a member is told about: `all` messages (opt-in), only `mentions`
// (and replies in threads they take part in), or `none` (muted).
export const channelNotificationLevel = pgEnum("channel_notification_level", [
  "all",
  "mentions",
  "none",
]);
// A system message is written by Lictory itself (channel archived, member
// added); an agent message names the agent and the person it acts for.
export const channelAuthorKind = pgEnum("channel_author_kind", [
  "user",
  "agent",
  "system",
]);
// A card renders an object (a promoted proposal, a decision, a discussion)
// from `payload` with its live state.
export const channelMessageKind = pgEnum("channel_message_kind", [
  "message",
  "system",
  "card",
]);
export const channelPromotionKind = pgEnum("channel_promotion_kind", [
  "proposal",
  "decision",
  "discussion",
]);

// Synchronized. A conversation. `lastSequence` is the channel's message
// counter (every message, replies included, takes the next value), and
// `rootCount` counts top-level messages, so a member's unread count is
// `rootCount - readRootCount`: arithmetic, no row per unread message.
export const channel = pgTable(
  "channel",
  {
    id: id(),
    organizationId: organizationId(),
    kind: channelKind("kind").notNull(),
    // Lowercase handle (`payments`), unique in the organization; null for
    // direct conversations, which are named by their members.
    name: text("name"),
    topic: text("topic").default("").notNull(),
    // Optional home: a project, or a team of that project.
    projectId: text("project_id"),
    teamId: text("team_id"),
    // Direct conversations: their sorted member keys, so opening the same
    // conversation twice finds the existing one.
    directKey: text("direct_key"),
    lastSequence: integer("last_sequence").default(0).notNull(),
    rootCount: integer("root_count").default(0).notNull(),
    lastMessageAt: timestamp("last_message_at"),
    createdById: optionalActor("created_by_id").notNull(),
    archivedAt: timestamp("archived_at"),
    archivedById: optionalActor("archived_by_id"),
    // A channel linked to a channel of an external chat system (a
    // ChatProvider such as Slack). Messages written there are owned there.
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("channel_org_id_unique").on(t.organizationId, t.id),
    uniqueIndex("channel_name_unique")
      .on(t.organizationId, sql`lower(${t.name})`)
      .where(sql`${t.name} IS NOT NULL`),
    uniqueIndex("channel_direct_key_unique")
      .on(t.organizationId, t.directKey)
      .where(sql`${t.directKey} IS NOT NULL`),
    uniqueIndex("channel_external_unique")
      .on(t.organizationId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    foreignKey({
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.projectId, t.teamId],
      foreignColumns: [team.organizationId, team.projectId, team.id],
    }).onDelete("restrict"),
    index("channel_org_kind_idx").on(t.organizationId, t.kind),
    check(
      "channel_team_needs_project",
      sql`${t.teamId} IS NULL OR ${t.projectId} IS NOT NULL`,
    ),
    check(
      "channel_name_by_kind",
      sql`(${t.kind} = 'direct') = (${t.name} IS NULL)
        AND (${t.kind} = 'direct') = (${t.directKey} IS NOT NULL)`,
    ),
    check(
      "channel_name_format",
      sql`${t.name} IS NULL OR ${t.name} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`,
    ),
    check("channel_topic_length", sql`length(${t.topic}) <= 250`),
    check(
      "channel_archive_consistent",
      sql`(${t.archivedAt} IS NULL) = (${t.archivedById} IS NULL)`,
    ),
    check(
      "channel_external_pair",
      sql`(${t.externalSource} IS NULL) = (${t.externalId} IS NULL)`,
    ),
    check(
      "channel_counters",
      sql`${t.lastSequence} >= 0 AND ${t.rootCount} >= 0 AND ${t.rootCount} <= ${t.lastSequence}`,
    ),
  ],
);

// Synchronized. A person or an agent in a channel. Agents are stored by id
// without a foreign key (the agent registry is its own module); their
// handles resolve through the AgentDirectory port (channels/agents.ts).
// The read cursor is a channel sequence plus the number of top-level
// messages up to it; `mentionCount` counts unread mentions of the member.
export const channelMember = pgTable(
  "channel_member",
  {
    id: id(),
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    memberKind: channelMemberKind("member_kind").notNull(),
    userId: optionalActor("user_id"),
    agentId: text("agent_id"),
    readSequence: integer("read_sequence").default(0).notNull(),
    readRootCount: integer("read_root_count").default(0).notNull(),
    mentionCount: integer("mention_count").default(0).notNull(),
    notificationLevel: channelNotificationLevel("notification_level")
      .default("mentions")
      .notNull(),
    addedById: optionalActor("added_by_id"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.channelId],
      foreignColumns: [channel.organizationId, channel.id],
    }).onDelete("restrict"),
    uniqueIndex("channel_member_user_unique")
      .on(t.channelId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("channel_member_agent_unique")
      .on(t.channelId, t.agentId)
      .where(sql`${t.agentId} IS NOT NULL`),
    index("channel_member_user_idx").on(t.organizationId, t.userId),
    check(
      "channel_member_identity",
      sql`(${t.memberKind} = 'user' AND ${t.userId} IS NOT NULL AND ${t.agentId} IS NULL)
        OR (${t.memberKind} = 'agent' AND ${t.agentId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
    check(
      "channel_member_cursor",
      sql`${t.readSequence} >= 0 AND ${t.readRootCount} >= 0 AND ${t.mentionCount} >= 0`,
    ),
  ],
);

// A file attached to a message (metadata only; bytes are private objects,
// read through /api/files/{id} with channel access).
export type ChannelAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

// Synchronized. One message. `sequence` is unique and increasing in its
// channel and assigned under the channel's transaction lock; replies point
// at their thread root (threads are one level deep). Root messages carry
// their reply count, last reply and the latest distinct repliers. An edit
// keeps the previous body in `channel_message_revision`; a deletion leaves a
// tombstone (the row with its place, thread and reactions, an empty body and
// `deletedAt`). A message from an external chat system names it
// (`externalSource`, `externalId`) and only that system edits or deletes it.
export const channelMessage = pgTable(
  "channel_message",
  {
    id: id(),
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    sequence: integer("sequence").notNull(),
    threadRootId: text("thread_root_id"),
    // Position among the channel's top-level messages (1-based); null for
    // replies. Read cursors count roots with it.
    rootIndex: integer("root_index"),
    authorKind: channelAuthorKind("author_kind").notNull(),
    authorUserId: optionalActor("author_user_id"),
    authorAgentId: text("author_agent_id"),
    // The person an agent acts for (its accountable owner).
    onBehalfOfUserId: optionalActor("on_behalf_of_user_id"),
    // A delegated execution that is not a registered agent (an MCP access
    // token's name, Litto), shown as "Ada via Forge token".
    via: text("via"),
    kind: channelMessageKind("kind").default("message").notNull(),
    // Markdown with mention (`@[Ada](mention:USER_ID)`,
    // `@[forge](agent:AGENT_ID)`) and reference tokens.
    body: text("body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    attachments: jsonb("attachments")
      .$type<ChannelAttachment[]>()
      .default([])
      .notNull(),
    clientMessageId: text("client_message_id"),
    replyCount: integer("reply_count").default(0).notNull(),
    lastReplyAt: timestamp("last_reply_at"),
    // Latest distinct repliers (up to five author keys, newest first).
    replyAuthors: jsonb("reply_authors")
      .$type<string[]>()
      .default([])
      .notNull(),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    deletedById: optionalActor("deleted_by_id"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("channel_message_org_id_unique").on(t.organizationId, t.id),
    unique("channel_message_sequence_unique").on(t.channelId, t.sequence),
    foreignKey({
      columns: [t.organizationId, t.channelId],
      foreignColumns: [channel.organizationId, channel.id],
    }).onDelete("restrict"),
    // NO ACTION (checked at the end of the statement), so deleting a
    // channel's messages in one statement removes roots with their replies.
    foreignKey({
      columns: [t.organizationId, t.threadRootId],
      foreignColumns: [t.organizationId, t.id],
    }),
    uniqueIndex("channel_message_client_unique")
      .on(t.channelId, t.clientMessageId)
      .where(sql`${t.clientMessageId} IS NOT NULL`),
    uniqueIndex("channel_message_external_unique")
      .on(t.organizationId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    uniqueIndex("channel_message_root_index_unique")
      .on(t.channelId, t.rootIndex)
      .where(sql`${t.rootIndex} IS NOT NULL`),
    index("channel_message_thread_idx")
      .on(t.threadRootId, t.sequence)
      .where(sql`${t.threadRootId} IS NOT NULL`),
    // Message search: PostgreSQL full text over live bodies.
    index("channel_message_search_idx")
      .using("gin", sql`to_tsvector('simple', ${t.body})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check("channel_message_body_length", sql`length(${t.body}) <= 16000`),
    check(
      "channel_message_root_index",
      sql`(${t.threadRootId} IS NULL) = (${t.rootIndex} IS NOT NULL)`,
    ),
    check(
      "channel_message_author",
      sql`(${t.authorKind} = 'user' AND ${t.authorUserId} IS NOT NULL AND ${t.authorAgentId} IS NULL)
        OR (${t.authorKind} = 'agent' AND ${t.authorAgentId} IS NOT NULL AND ${t.onBehalfOfUserId} IS NOT NULL AND ${t.authorUserId} IS NULL)
        OR (${t.authorKind} = 'system' AND ${t.authorAgentId} IS NULL)`,
    ),
    check(
      "channel_message_deleted",
      sql`${t.deletedAt} IS NULL OR length(${t.body}) = 0`,
    ),
    check(
      "channel_message_external_pair",
      sql`(${t.externalSource} IS NULL) = (${t.externalId} IS NULL)`,
    ),
  ],
);

// Previous bodies of edited and deleted messages, kept so history is never
// silently rewritten. Server-only: not synchronized and not readable through
// any capability; it leaves with its organization.
export const channelMessageRevision = pgTable(
  "channel_message_revision",
  {
    id: id(),
    organizationId: organizationId(),
    messageId: text("message_id").notNull(),
    body: text("body").notNull(),
    // Why this body was replaced: `edited` or `deleted`.
    reason: text("reason").notNull(),
    changedById: optionalActor("changed_by_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [channelMessage.organizationId, channelMessage.id],
    }).onDelete("restrict"),
    index("channel_message_revision_message_idx").on(t.messageId),
    check(
      "channel_message_revision_reason",
      sql`${t.reason} in ('edited', 'deleted')`,
    ),
  ],
);

// Synchronized. One emoji reaction of one person or agent. The id is
// deterministic (`message|reactor|emoji`), so a browser's predicted row and
// the stored one are the same row.
export const channelReaction = pgTable(
  "channel_reaction",
  {
    id: text("id").primaryKey(),
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    emoji: text("emoji").notNull(),
    reactorKind: channelMemberKind("reactor_kind").notNull(),
    userId: optionalActor("user_id"),
    agentId: text("agent_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [channelMessage.organizationId, channelMessage.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.channelId],
      foreignColumns: [channel.organizationId, channel.id],
    }).onDelete("restrict"),
    index("channel_reaction_message_idx").on(t.messageId),
    index("channel_reaction_channel_idx").on(t.channelId),
    check("channel_reaction_emoji", sql`length(${t.emoji}) between 1 and 64`),
    check(
      "channel_reaction_identity",
      sql`(${t.reactorKind} = 'user' AND ${t.userId} IS NOT NULL AND ${t.agentId} IS NULL)
        OR (${t.reactorKind} = 'agent' AND ${t.agentId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
  ],
);

// Who a message mentions, as the server resolved it (people it checked as
// members, agents through the AgentDirectory). Server-only: used to count
// unread mentions and to notify.
export const channelMention = pgTable(
  "channel_mention",
  {
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    sequence: integer("sequence").notNull(),
    mentionedKind: channelMemberKind("mentioned_kind").notNull(),
    // The mentioned person, or the agent's id.
    mentionedId: text("mentioned_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.mentionedKind, t.mentionedId] }),
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [channelMessage.organizationId, channelMessage.id],
    }).onDelete("restrict"),
    index("channel_mention_recipient_idx").on(
      t.channelId,
      t.mentionedId,
      t.sequence,
    ),
  ],
);

// Synchronized (each person only reads their own). A person taking part in
// a thread: they started it, replied, were mentioned in it or followed it.
// Participants are told about replies; `readReplyCount` against the root's
// `replyCount` is the thread's unread count.
export const channelThreadParticipant = pgTable(
  "channel_thread_participant",
  {
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    rootMessageId: text("root_message_id").notNull(),
    userId: optionalActor("user_id").notNull(),
    readReplyCount: integer("read_reply_count").default(0).notNull(),
    // False: the person unfollowed the thread and is no longer told.
    following: boolean("following").default(true).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.rootMessageId, t.userId] }),
    foreignKey({
      columns: [t.organizationId, t.rootMessageId],
      foreignColumns: [channelMessage.organizationId, channelMessage.id],
    }).onDelete("restrict"),
    index("channel_thread_participant_user_idx").on(t.organizationId, t.userId),
  ],
);

// Synchronized. What a message (or its thread) was promoted into: a proposal
// (a work item), a decision or an anchored discussion on a specification.
// It links both ways: the card message in the thread names the object, and
// the object's page finds its conversation through this row (only for people
// who can read the channel).
export const channelPromotion = pgTable(
  "channel_promotion",
  {
    id: id(),
    organizationId: organizationId(),
    channelId: text("channel_id").notNull(),
    // The promoted message (a thread root when the whole thread was).
    messageId: text("message_id").notNull(),
    kind: channelPromotionKind("kind").notNull(),
    workItemId: text("work_item_id").notNull(),
    decisionId: text("decision_id"),
    threadId: text("thread_id"),
    // The card left in the thread.
    cardMessageId: text("card_message_id"),
    // The workspace mutation that created the object (idempotent retries).
    mutationId: text("mutation_id").notNull(),
    createdById: optionalActor("created_by_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.messageId],
      foreignColumns: [channelMessage.organizationId, channelMessage.id],
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.organizationId, t.channelId],
      foreignColumns: [channel.organizationId, channel.id],
    }).onDelete("restrict"),
    uniqueIndex("channel_promotion_mutation_unique").on(
      t.organizationId,
      t.mutationId,
    ),
    index("channel_promotion_message_idx").on(t.messageId),
    index("channel_promotion_work_item_idx").on(t.organizationId, t.workItemId),
    check(
      "channel_promotion_target",
      sql`(${t.kind} <> 'decision' OR ${t.decisionId} IS NOT NULL)
        AND (${t.kind} <> 'discussion' OR ${t.threadId} IS NOT NULL)`,
    ),
  ],
);
