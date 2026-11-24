import {
  boolean,
  createBuilder,
  createSchema,
  json,
  number,
  relationships,
  string,
  table,
  type ReadonlyJSONValue,
} from "@rocicorp/zero";
import type { ChannelAttachment } from "@lictory/core/db/channel-schema";

// The Zero schema covers exactly the replicated publication `lictory_zero`
// (drizzle/0018_zero_publication.sql, 0035_spaces_zero_publication.sql and
// the Factory's and Channels' publication migrations): read projections, the
// membership columns that authorize every synced query, Lictory Spaces'
// projections and effective access, Code projections, Factory projections and session events,
// and Lictory Channels' synchronization-shaped rows. Other domain tables are
// never synced.

const member = table("member")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    userId: string().from("user_id"),
    role: string(),
  })
  .primaryKey("id");

const syncEntity = table("syncEntity")
  .from("sync_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    projectId: string().from("project_id").optional(),
    workItemId: string().from("work_item_id").optional(),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

// Lictory Spaces projections, apart from `syncEntity` so the organization and
// work item queries can never return space data. A NULL `pageId` marks a
// space-level row (space, grants, page tree); otherwise the row belongs to
// that page's history. Knowledge links also name the work item or project
// they concern (docs/internals/knowledge-links.md).
const spaceEntity = table("spaceEntity")
  .from("space_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    spaceId: string().from("space_id"),
    pageId: string().from("page_id").optional(),
    workItemId: string().from("work_item_id").optional(),
    projectId: string().from("project_id").optional(),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

// Effective access to a space: one row per person who can read it, with
// their level (view, comment or edit).
const spaceReader = table("spaceReader")
  .from("space_reader")
  .columns({
    organizationId: string().from("organization_id"),
    spaceId: string().from("space_id"),
    userId: string().from("user_id"),
    level: string(),
  })
  .primaryKey("spaceId", "userId");

// Factory projections (agents, runners, session summaries) and the agent
// session event log, an append-only table shaped for synchronization
// (docs/internals/factory.md#synchronization). Every member of the
// organization reads them.
const factoryEntity = table("factoryEntity")
  .from("factory_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

const agentSessionEvent = table("agentSessionEvent")
  .from("agent_session_event")
  .columns({
    organizationId: string().from("organization_id"),
    sessionId: string().from("session_id"),
    sequence: number(),
    type: string(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("sessionId", "sequence");

// Lictory Channels (drizzle/0051_channels_zero_publication.sql). These rows
// are shaped for synchronization; every Channels query authorizes through
// organization membership and channel access: a public channel for
// organization members, a private or direct one for its members only.
const channel = table("channel")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    kind: string(),
    name: string().optional(),
    topic: string(),
    projectId: string().from("project_id").optional(),
    teamId: string().from("team_id").optional(),
    lastSequence: number().from("last_sequence"),
    rootCount: number().from("root_count"),
    lastMessageAt: number().from("last_message_at").optional(),
    createdById: string().from("created_by_id"),
    archivedAt: number().from("archived_at").optional(),
    externalSource: string().from("external_source").optional(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

const channelMember = table("channelMember")
  .from("channel_member")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    channelId: string().from("channel_id"),
    memberKind: string().from("member_kind"),
    userId: string().from("user_id").optional(),
    agentId: string().from("agent_id").optional(),
    readSequence: number().from("read_sequence"),
    readRootCount: number().from("read_root_count"),
    mentionCount: number().from("mention_count"),
    notificationLevel: string().from("notification_level"),
    joinedAt: number().from("joined_at"),
  })
  .primaryKey("id");

const channelMessage = table("channelMessage")
  .from("channel_message")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    channelId: string().from("channel_id"),
    sequence: number(),
    threadRootId: string().from("thread_root_id").optional(),
    rootIndex: number().from("root_index").optional(),
    authorKind: string().from("author_kind"),
    authorUserId: string().from("author_user_id").optional(),
    authorAgentId: string().from("author_agent_id").optional(),
    onBehalfOfUserId: string().from("on_behalf_of_user_id").optional(),
    via: string().optional(),
    kind: string(),
    body: string(),
    payload: json<Readonly<Record<string, ReadonlyJSONValue>>>().optional(),
    attachments: json<readonly ChannelAttachment[]>(),
    replyCount: number().from("reply_count"),
    lastReplyAt: number().from("last_reply_at").optional(),
    replyAuthors: json<readonly string[]>().from("reply_authors"),
    editedAt: number().from("edited_at").optional(),
    deletedAt: number().from("deleted_at").optional(),
    externalSource: string().from("external_source").optional(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

const channelReaction = table("channelReaction")
  .from("channel_reaction")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    channelId: string().from("channel_id"),
    messageId: string().from("message_id"),
    emoji: string(),
    reactorKind: string().from("reactor_kind"),
    userId: string().from("user_id").optional(),
    agentId: string().from("agent_id").optional(),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

const channelThreadParticipant = table("channelThreadParticipant")
  .from("channel_thread_participant")
  .columns({
    organizationId: string().from("organization_id"),
    channelId: string().from("channel_id"),
    rootMessageId: string().from("root_message_id"),
    userId: string().from("user_id"),
    readReplyCount: number().from("read_reply_count"),
    following: boolean(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("rootMessageId", "userId");

const channelPromotion = table("channelPromotion")
  .from("channel_promotion")
  .columns({
    id: string(),
    organizationId: string().from("organization_id"),
    channelId: string().from("channel_id"),
    messageId: string().from("message_id"),
    kind: string(),
    workItemId: string().from("work_item_id"),
    decisionId: string().from("decision_id").optional(),
    threadId: string().from("thread_id").optional(),
    cardMessageId: string().from("card_message_id").optional(),
    createdById: string().from("created_by_id"),
    createdAt: number().from("created_at"),
  })
  .primaryKey("id");

// Every channel-scoped row reaches its channel (for channel access) and the
// organization's members (for organization membership).
const toOrgMembers = {
  sourceField: ["organizationId"],
  destSchema: member,
  destField: ["organizationId"],
} as const;
const channelRelationships = relationships(channel, ({ many }) => ({
  orgMembers: many(toOrgMembers),
  members: many({
    sourceField: ["id"],
    destSchema: channelMember,
    destField: ["channelId"],
  }),
}));
const channelMemberRelationships = relationships(
  channelMember,
  ({ many, one }) => ({
    orgMembers: many(toOrgMembers),
    channel: one({
      sourceField: ["channelId"],
      destSchema: channel,
      destField: ["id"],
    }),
  }),
);
const channelMessageRelationships = relationships(
  channelMessage,
  ({ many, one }) => ({
    orgMembers: many(toOrgMembers),
    channel: one({
      sourceField: ["channelId"],
      destSchema: channel,
      destField: ["id"],
    }),
    reactions: many({
      sourceField: ["id"],
      destSchema: channelReaction,
      destField: ["messageId"],
    }),
  }),
);
const channelReactionRelationships = relationships(
  channelReaction,
  ({ many, one }) => ({
    orgMembers: many(toOrgMembers),
    channel: one({
      sourceField: ["channelId"],
      destSchema: channel,
      destField: ["id"],
    }),
  }),
);
const channelThreadParticipantRelationships = relationships(
  channelThreadParticipant,
  ({ many, one }) => ({
    orgMembers: many(toOrgMembers),
    channel: one({
      sourceField: ["channelId"],
      destSchema: channel,
      destField: ["id"],
    }),
  }),
);
const channelPromotionRelationships = relationships(
  channelPromotion,
  ({ many, one }) => ({
    orgMembers: many(toOrgMembers),
    channel: one({
      sourceField: ["channelId"],
      destSchema: channel,
      destField: ["id"],
    }),
  }),
);

// Code module projections (docs/internals/code-hosts.md#projections), apart
// from `syncEntity` so the organization and work item queries never return
// code rows. `workItemId` marks rows of one item's Code panel; `facet`
// (open, closed, merged) narrows pull requests and issues.
const codeEntity = table("codeEntity")
  .from("code_entity")
  .columns({
    key: string(),
    organizationId: string().from("organization_id"),
    repositoryId: string().from("repository_id").optional(),
    projectId: string().from("project_id").optional(),
    workItemId: string().from("work_item_id").optional(),
    type: string(),
    facet: string().optional(),
    data: json<Readonly<Record<string, ReadonlyJSONValue>>>(),
    updatedAt: number().from("updated_at"),
  })
  .primaryKey("key");

const memberRelationships = relationships(member, ({ many }) => ({
  // Filtered to the `organizationProfile` row by the memberships query.
  organization: many({
    sourceField: ["organizationId"],
    destSchema: syncEntity,
    destField: ["organizationId"],
  }),
}));

const syncEntityRelationships = relationships(syncEntity, ({ many }) => ({
  // Every synced query requires the current user's membership through this
  // relationship, so removing a member removes rows from open subscriptions.
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const spaceEntityRelationships = relationships(spaceEntity, ({ many }) => ({
  // Spaces queries require both a reader row of the row's space and an
  // organization membership, so revoking either removes the rows.
  readers: many({
    sourceField: ["organizationId", "spaceId"],
    destSchema: spaceReader,
    destField: ["organizationId", "spaceId"],
  }),
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const spaceReaderRelationships = relationships(spaceReader, ({ many }) => ({
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const factoryEntityRelationships = relationships(factoryEntity, ({ many }) => ({
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

const agentSessionEventRelationships = relationships(
  agentSessionEvent,
  ({ many }) => ({
    members: many({
      sourceField: ["organizationId"],
      destSchema: member,
      destField: ["organizationId"],
    }),
  }),
);

const codeEntityRelationships = relationships(codeEntity, ({ many }) => ({
  // Code rows are organization-wide, like work items: every query requires
  // the current user's membership through this relationship.
  members: many({
    sourceField: ["organizationId"],
    destSchema: member,
    destField: ["organizationId"],
  }),
}));

export const schema = createSchema({
  tables: [
    member,
    syncEntity,
    spaceEntity,
    spaceReader,
    codeEntity,
    factoryEntity,
    agentSessionEvent,
    channel,
    channelMember,
    channelMessage,
    channelReaction,
    channelThreadParticipant,
    channelPromotion,
  ],
  relationships: [
    memberRelationships,
    syncEntityRelationships,
    spaceEntityRelationships,
    spaceReaderRelationships,
    codeEntityRelationships,
    factoryEntityRelationships,
    agentSessionEventRelationships,
    channelRelationships,
    channelMemberRelationships,
    channelMessageRelationships,
    channelReactionRelationships,
    channelThreadParticipantRelationships,
    channelPromotionRelationships,
  ],
});

export type Schema = typeof schema;
export const zql = createBuilder(schema);
