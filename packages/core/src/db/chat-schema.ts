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
import { organization, user } from "@lictory/core/db/auth-schema";

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
    version: integer("version").default(0).notNull(),
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

// Private execution state. None of these tables belong to Zero's publication.
export const intelligenceChatRun = pgTable(
  "intelligence_chat_run",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => intelligenceChat.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    assistantId: text("assistant_id").notNull(),
    // Null identifies the original submission; retries have their own input ID.
    requestId: text("request_id"),
    position: integer("position").notNull(),
    checkpoint: jsonb("checkpoint").notNull(),
    steps: integer("steps").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("intelligence_chat_run_pending_idx").on(t.status, t.leaseUntil),
    index("intelligence_chat_run_chat_idx").on(t.chatId, t.createdAt),
    uniqueIndex("intelligence_chat_run_active_idx")
      .on(t.chatId)
      .where(sql`${t.status} in ('queued', 'running', 'waiting')`),
    check(
      "intelligence_chat_run_status",
      sql`${t.status} in ('queued', 'running', 'waiting', 'completed', 'canceled', 'failed')`,
    ),
  ],
);

// Durable input receipts also remember Stop arriving before submission.
export const intelligenceChatRequest = pgTable(
  "intelligence_chat_request",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => intelligenceChat.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.id] })],
);

// A tool's identity and arguments commit before execution. Its result commits
// with the transcript checkpoint; a lost worker reuses the same mutation ID.
export const intelligenceChatTool = pgTable(
  "intelligence_chat_tool",
  {
    runId: text("run_id")
      .notNull()
      .references(() => intelligenceChatRun.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    name: text("name").notNull(),
    input: jsonb("input").notNull(),
    replayable: boolean("replayable").notNull(),
    completed: boolean("completed").notNull().default(false),
    output: jsonb("output"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.toolCallId] })],
);
