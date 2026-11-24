CREATE TYPE "public"."slack_installation_status" AS ENUM('pending', 'connected', 'invalid', 'disconnected');--> statement-breakpoint
ALTER TYPE "public"."channel_author_kind" ADD VALUE 'external';--> statement-breakpoint
CREATE TABLE "channel_external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text NOT NULL,
	"external_url" text,
	"health" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_error_at" timestamp,
	"last_synced_at" timestamp,
	"backfill_limit" integer DEFAULT 0 NOT NULL,
	"backfilled_at" timestamp,
	"linked_by_id" text NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"unlinked_by_id" text,
	"unlinked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_external_link_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "channel_external_link_health" CHECK ("channel_external_link"."health" in ('ok', 'failing')),
	CONSTRAINT "channel_external_link_backfill" CHECK ("channel_external_link"."backfill_limit" between 0 and 200),
	CONSTRAINT "channel_external_link_unlinked" CHECK (("channel_external_link"."unlinked_at" IS NULL) = ("channel_external_link"."unlinked_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "channel_mirror" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"link_id" text NOT NULL,
	"target" text NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"external_id" text,
	"present" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_version" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp,
	"failed_at" timestamp,
	"last_error" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_mirror_target" CHECK (("channel_mirror"."target" = 'message' AND "channel_mirror"."emoji" = '') OR ("channel_mirror"."target" = 'reaction' AND length("channel_mirror"."emoji") between 1 and 64)),
	CONSTRAINT "channel_mirror_attempts" CHECK ("channel_mirror"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "slack_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp DEFAULT now(),
	"attempts" integer DEFAULT 0 NOT NULL,
	"leased_until" timestamp,
	"processed_at" timestamp,
	"failed_at" timestamp,
	"last_error" text,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "slack_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"encrypted_signing_secret" text NOT NULL,
	"encrypted_bot_token" text,
	"team_id" text,
	"team_name" text,
	"team_url" text,
	"bot_user_id" text,
	"bot_id" text,
	"scopes" text DEFAULT '' NOT NULL,
	"intelligence_reads" boolean DEFAULT false NOT NULL,
	"status" "slack_installation_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_error_at" timestamp,
	"last_event_at" timestamp,
	"oauth_state_hash" text,
	"oauth_state_user_id" text,
	"oauth_state_expires_at" timestamp,
	"installed_by_id" text,
	"installed_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_installation_org_unique" UNIQUE("organization_id"),
	CONSTRAINT "slack_installation_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "slack_installation_connected" CHECK ("slack_installation"."status" <> 'connected' OR ("slack_installation"."encrypted_bot_token" IS NOT NULL AND "slack_installation"."team_id" IS NOT NULL AND "slack_installation"."bot_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "slack_user" (
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"name" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_user_installation_id_slack_user_id_pk" PRIMARY KEY("installation_id","slack_user_id")
);
--> statement-breakpoint
ALTER TABLE "channel_message" DROP CONSTRAINT "channel_message_author";--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "external_author_id" text;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "external_author_name" text;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "external_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_message" ADD COLUMN "external_reactions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_reaction" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "channel_external_link" ADD CONSTRAINT "channel_external_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_external_link" ADD CONSTRAINT "channel_external_link_linked_by_id_user_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_external_link" ADD CONSTRAINT "channel_external_link_unlinked_by_id_user_id_fk" FOREIGN KEY ("unlinked_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_external_link" ADD CONSTRAINT "channel_external_link_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mirror" ADD CONSTRAINT "channel_mirror_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mirror" ADD CONSTRAINT "channel_mirror_organization_id_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mirror" ADD CONSTRAINT "channel_mirror_organization_id_link_id_channel_external_link_organization_id_id_fk" FOREIGN KEY ("organization_id","link_id") REFERENCES "public"."channel_external_link"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_event" ADD CONSTRAINT "slack_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_event" ADD CONSTRAINT "slack_event_organization_id_installation_id_slack_installation_organization_id_id_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "public"."slack_installation"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_installed_by_id_user_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user" ADD CONSTRAINT "slack_user_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user" ADD CONSTRAINT "slack_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user" ADD CONSTRAINT "slack_user_organization_id_installation_id_slack_installation_organization_id_id_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "public"."slack_installation"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_external_link_active_channel" ON "channel_external_link" USING btree ("channel_id") WHERE "channel_external_link"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_external_link_active_external" ON "channel_external_link" USING btree ("organization_id","source","external_id") WHERE "channel_external_link"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_mirror_target_unique" ON "channel_mirror" USING btree ("message_id","target","emoji");--> statement-breakpoint
CREATE INDEX "channel_mirror_due_idx" ON "channel_mirror" USING btree ("due_at") WHERE "channel_mirror"."due_at" IS NOT NULL AND "channel_mirror"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "channel_mirror_failed_idx" ON "channel_mirror" USING btree ("channel_id") WHERE "channel_mirror"."failed_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_event_unique" ON "slack_event" USING btree ("installation_id","event_id");--> statement-breakpoint
CREATE INDEX "slack_event_due_idx" ON "slack_event" USING btree ("due_at") WHERE "slack_event"."processed_at" IS NULL AND "slack_event"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "slack_installation_state_idx" ON "slack_installation" USING btree ("oauth_state_hash");--> statement-breakpoint
CREATE INDEX "slack_user_user_idx" ON "slack_user" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_author" CHECK (("channel_message"."author_kind" = 'user' AND "channel_message"."author_user_id" IS NOT NULL AND "channel_message"."author_agent_id" IS NULL)
        OR ("channel_message"."author_kind" = 'agent' AND "channel_message"."author_agent_id" IS NOT NULL AND "channel_message"."on_behalf_of_user_id" IS NOT NULL AND "channel_message"."author_user_id" IS NULL)
        OR ("channel_message"."author_kind" = 'system' AND "channel_message"."author_agent_id" IS NULL)
        OR ("channel_message"."author_kind"::text = 'external' AND "channel_message"."author_user_id" IS NULL AND "channel_message"."author_agent_id" IS NULL
          AND "channel_message"."external_source" IS NOT NULL AND "channel_message"."external_author_name" IS NOT NULL));