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

// Slack, the first ChatProvider (docs/internals/channels.md#slack). Server
// only: nothing here is replicated. Credentials (the app's client secret
// and signing secret, the bot token) are encrypted at rest with the
// delivery credentials key, bound to the organization
// (delivery/credentials.ts), and never leave the server.

const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

// pending: the app's credentials are saved, the app is not installed yet.
// connected: installed, with a bot token. invalid: Slack refused the token
// (uninstalled, revoked) and an administrator must reinstall.
// disconnected: an administrator disconnected it; the app's credentials stay
// so installing again needs no new app.
export const slackInstallationStatus = pgEnum("slack_installation_status", [
  "pending",
  "connected",
  "invalid",
  "disconnected",
]);

// One Slack app per organization: each installation is the customer's own
// internal app, created from the manifest Lictory generates for it.
export const slackInstallation = pgTable(
  "slack_installation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    appId: text("app_id").notNull(),
    clientId: text("client_id").notNull(),
    encryptedClientSecret: text("encrypted_client_secret").notNull(),
    encryptedSigningSecret: text("encrypted_signing_secret").notNull(),
    encryptedBotToken: text("encrypted_bot_token"),
    // The workspace the app is installed in.
    teamId: text("team_id"),
    teamName: text("team_name"),
    teamUrl: text("team_url"),
    botUserId: text("bot_user_id"),
    botId: text("bot_id"),
    scopes: text("scopes").default("").notNull(),
    // Whether Lictory Intelligence (Litto, AI analysis) may read messages
    // written in Slack, when the organization's AI policy enables it at
    // all. Off by default: Slack content reaches an AI provider only when
    // an administrator allows it.
    intelligenceReads: boolean("intelligence_reads").default(false).notNull(),
    status: slackInstallationStatus("status").default("pending").notNull(),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at"),
    lastEventAt: timestamp("last_event_at"),
    // The OAuth install in progress: a hash of the `state` sent to Slack,
    // who started it and until when it is accepted.
    oauthStateHash: text("oauth_state_hash"),
    oauthStateUserId: text("oauth_state_user_id"),
    oauthStateExpiresAt: timestamp("oauth_state_expires_at"),
    installedById: text("installed_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    installedAt: timestamp("installed_at"),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("slack_installation_org_unique").on(t.organizationId),
    unique("slack_installation_org_id_unique").on(t.organizationId, t.id),
    index("slack_installation_state_idx").on(t.oauthStateHash),
    check(
      "slack_installation_connected",
      sql`${t.status} <> 'connected' OR (${t.encryptedBotToken} IS NOT NULL AND ${t.teamId} IS NOT NULL AND ${t.botUserId} IS NOT NULL)`,
    ),
  ],
);

// Verified Events API deliveries, stored once (by Slack's event id) and
// acknowledged at once; the worker processes them under a lease through the
// conversation writer. Kept for a while after processing for inspection.
export const slackEvent = pgTable(
  "slack_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    dueAt: timestamp("due_at").defaultNow(),
    attempts: integer("attempts").default(0).notNull(),
    leasedUntil: timestamp("leased_until"),
    processedAt: timestamp("processed_at"),
    failedAt: timestamp("failed_at"),
    lastError: text("last_error"),
    // What processing did (`stored`, `ignored: own bot`…), for support.
    outcome: text("outcome"),
  },
  (t) => [
    foreignKey({
      columns: [t.organizationId, t.installationId],
      foreignColumns: [slackInstallation.organizationId, slackInstallation.id],
    }).onDelete("cascade"),
    uniqueIndex("slack_event_unique").on(t.installationId, t.eventId),
    index("slack_event_due_idx")
      .on(t.dueAt)
      .where(sql`${t.processedAt} IS NULL AND ${t.failedAt} IS NULL`),
  ],
);

// Slack people as Lictory last saw them: their name and whether they map to
// a Lictory person (`userId`: an organization member whose verified email
// is the one Slack confirmed). Emails are compared, never stored.
export const slackUser = pgTable(
  "slack_user",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    slackUserId: text("slack_user_id").notNull(),
    name: text("name").notNull(),
    isBot: boolean("is_bot").default(false).notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.installationId, t.slackUserId] }),
    foreignKey({
      columns: [t.organizationId, t.installationId],
      foreignColumns: [slackInstallation.organizationId, slackInstallation.id],
    }).onDelete("cascade"),
    index("slack_user_user_idx").on(t.organizationId, t.userId),
  ],
);
