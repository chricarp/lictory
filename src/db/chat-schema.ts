import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

// A Lictory Intelligence conversation. Chats are private to the person who
// started them, inside one organization: the assistant acts with exactly that
// person's permissions, so the transcript can contain anything they can read.
// Chats are not synchronized workspace entities; domain changes the assistant
// makes go through capabilities and are recorded there.
export const intelligenceChat = pgTable(
  "intelligence_chat",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Null until the assistant has named the conversation.
    title: text("title"),
    pinned: boolean("pinned").default(false).notNull(),
    // Quick conversations from the assistant dock stay out of the history
    // list until the person continues them on the Intelligence page.
    listed: boolean("listed").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("intelligence_chat_owner_idx").on(
      t.organizationId,
      t.userId,
      t.updatedAt,
    ),
  ],
);

// One UI message (AI SDK `UIMessage`): role plus its ordered parts (text,
// reasoning, tool calls with their results and approvals, clarifications).
export const intelligenceChatMessage = pgTable(
  "intelligence_chat_message",
  {
    // Client-generated, so only unique within its chat.
    id: text("id").notNull(),
    chatId: text("chat_id")
      .notNull()
      .references(() => intelligenceChat.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    // Message metadata (for example time spent working); null when absent.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.id] }),
    uniqueIndex("intelligence_chat_message_position_idx").on(
      t.chatId,
      t.position,
    ),
    check(
      "intelligence_chat_message_role",
      sql`${t.role} in ('user', 'assistant', 'system')`,
    ),
  ],
);
