CREATE TYPE "public"."channel_author_kind" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('public', 'private', 'direct');--> statement-breakpoint
CREATE TYPE "public"."channel_member_kind" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."channel_message_kind" AS ENUM('message', 'system', 'card');--> statement-breakpoint
CREATE TYPE "public"."channel_notification_level" AS ENUM('all', 'mentions', 'none');--> statement-breakpoint
CREATE TYPE "public"."channel_promotion_kind" AS ENUM('proposal', 'decision', 'discussion');--> statement-breakpoint
CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"name" text,
	"topic" text DEFAULT '' NOT NULL,
	"project_id" text,
	"team_id" text,
	"direct_key" text,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"root_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"created_by_id" text NOT NULL,
	"archived_at" timestamp,
	"archived_by_id" text,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "channel_team_needs_project" CHECK ("channel"."team_id" IS NULL OR "channel"."project_id" IS NOT NULL),
	CONSTRAINT "channel_name_by_kind" CHECK (("channel"."kind" = 'direct') = ("channel"."name" IS NULL)
        AND ("channel"."kind" = 'direct') = ("channel"."direct_key" IS NOT NULL)),
	CONSTRAINT "channel_name_format" CHECK ("channel"."name" IS NULL OR "channel"."name" ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
	CONSTRAINT "channel_topic_length" CHECK (length("channel"."topic") <= 250),
	CONSTRAINT "channel_archive_consistent" CHECK (("channel"."archived_at" IS NULL) = ("channel"."archived_by_id" IS NULL)),
	CONSTRAINT "channel_external_pair" CHECK (("channel"."external_source" IS NULL) = ("channel"."external_id" IS NULL)),
	CONSTRAINT "channel_counters" CHECK ("channel"."last_sequence" >= 0 AND "channel"."root_count" >= 0 AND "channel"."root_count" <= "channel"."last_sequence")
);
--> statement-breakpoint
CREATE TABLE "channel_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"member_kind" "channel_member_kind" NOT NULL,
	"user_id" text,
	"agent_id" text,
	"read_sequence" integer DEFAULT 0 NOT NULL,
	"read_root_count" integer DEFAULT 0 NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"notification_level" "channel_notification_level" DEFAULT 'mentions' NOT NULL,
	"added_by_id" text,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_member_identity" CHECK (("channel_member"."member_kind" = 'user' AND "channel_member"."user_id" IS NOT NULL AND "channel_member"."agent_id" IS NULL)
        OR ("channel_member"."member_kind" = 'agent' AND "channel_member"."agent_id" IS NOT NULL AND "channel_member"."user_id" IS NULL)),
	CONSTRAINT "channel_member_cursor" CHECK ("channel_member"."read_sequence" >= 0 AND "channel_member"."read_root_count" >= 0 AND "channel_member"."mention_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "channel_mention" (
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"mentioned_kind" "channel_member_kind" NOT NULL,
	"mentioned_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_mention_message_id_mentioned_kind_mentioned_id_pk" PRIMARY KEY("message_id","mentioned_kind","mentioned_id")
);
--> statement-breakpoint
CREATE TABLE "channel_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"thread_root_id" text,
	"root_index" integer,
	"author_kind" "channel_author_kind" NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"on_behalf_of_user_id" text,
	"via" text,
	"kind" "channel_message_kind" DEFAULT 'message' NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_message_id" text,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_reply_at" timestamp,
	"reply_authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "channel_message_sequence_unique" UNIQUE("channel_id","sequence"),
	CONSTRAINT "channel_message_body_length" CHECK (length("channel_message"."body") <= 16000),
	CONSTRAINT "channel_message_root_index" CHECK (("channel_message"."thread_root_id" IS NULL) = ("channel_message"."root_index" IS NOT NULL)),
	CONSTRAINT "channel_message_author" CHECK (("channel_message"."author_kind" = 'user' AND "channel_message"."author_user_id" IS NOT NULL AND "channel_message"."author_agent_id" IS NULL)
        OR ("channel_message"."author_kind" = 'agent' AND "channel_message"."author_agent_id" IS NOT NULL AND "channel_message"."on_behalf_of_user_id" IS NOT NULL AND "channel_message"."author_user_id" IS NULL)
        OR ("channel_message"."author_kind" = 'system' AND "channel_message"."author_agent_id" IS NULL)),
	CONSTRAINT "channel_message_deleted" CHECK ("channel_message"."deleted_at" IS NULL OR length("channel_message"."body") = 0),
	CONSTRAINT "channel_message_external_pair" CHECK (("channel_message"."external_source" IS NULL) = ("channel_message"."external_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "channel_message_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"changed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_message_revision_reason" CHECK ("channel_message_revision"."reason" in ('edited', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "channel_promotion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"kind" "channel_promotion_kind" NOT NULL,
	"work_item_id" text NOT NULL,
	"decision_id" text,
	"thread_id" text,
	"card_message_id" text,
	"mutation_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_promotion_target" CHECK (("channel_promotion"."kind" <> 'decision' OR "channel_promotion"."decision_id" IS NOT NULL)
        AND ("channel_promotion"."kind" <> 'discussion' OR "channel_promotion"."thread_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "channel_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"emoji" text NOT NULL,
	"reactor_kind" "channel_member_kind" NOT NULL,
	"user_id" text,
	"agent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_reaction_emoji" CHECK (length("channel_reaction"."emoji") between 1 and 64),
	CONSTRAINT "channel_reaction_identity" CHECK (("channel_reaction"."reactor_kind" = 'user' AND "channel_reaction"."user_id" IS NOT NULL AND "channel_reaction"."agent_id" IS NULL)
        OR ("channel_reaction"."reactor_kind" = 'agent' AND "channel_reaction"."agent_id" IS NOT NULL AND "channel_reaction"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "channel_thread_participant" (
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_reply_count" integer DEFAULT 0 NOT NULL,
	"following" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_thread_participant_root_message_id_user_id_pk" PRIMARY KEY("root_message_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "file_object" DROP CONSTRAINT "file_object_one_owner";--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_archived_by_id_user_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_organization_id_project_id_team_id_team_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","team_id") REFERENCES "public"."team"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_added_by_id_user_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mention" ADD CONSTRAINT "channel_mention_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mention" ADD CONSTRAINT "channel_mention_organization_id_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_on_behalf_of_user_id_user_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message" ADD CONSTRAINT "channel_message_organization_id_thread_root_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","thread_root_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_revision" ADD CONSTRAINT "channel_message_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_revision" ADD CONSTRAINT "channel_message_revision_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_revision" ADD CONSTRAINT "channel_message_revision_organization_id_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_promotion" ADD CONSTRAINT "channel_promotion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_promotion" ADD CONSTRAINT "channel_promotion_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_promotion" ADD CONSTRAINT "channel_promotion_organization_id_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_promotion" ADD CONSTRAINT "channel_promotion_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reaction" ADD CONSTRAINT "channel_reaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reaction" ADD CONSTRAINT "channel_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reaction" ADD CONSTRAINT "channel_reaction_organization_id_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_reaction" ADD CONSTRAINT "channel_reaction_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_thread_participant" ADD CONSTRAINT "channel_thread_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_thread_participant" ADD CONSTRAINT "channel_thread_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_thread_participant" ADD CONSTRAINT "channel_thread_participant_organization_id_root_message_id_channel_message_organization_id_id_fk" FOREIGN KEY ("organization_id","root_message_id") REFERENCES "public"."channel_message"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_name_unique" ON "channel" USING btree ("organization_id",lower("name")) WHERE "channel"."name" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_direct_key_unique" ON "channel" USING btree ("organization_id","direct_key") WHERE "channel"."direct_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_external_unique" ON "channel" USING btree ("organization_id","external_source","external_id") WHERE "channel"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_org_kind_idx" ON "channel" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_member_user_unique" ON "channel_member" USING btree ("channel_id","user_id") WHERE "channel_member"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_member_agent_unique" ON "channel_member" USING btree ("channel_id","agent_id") WHERE "channel_member"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_member_user_idx" ON "channel_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "channel_mention_recipient_idx" ON "channel_mention" USING btree ("channel_id","mentioned_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_client_unique" ON "channel_message" USING btree ("channel_id","client_message_id") WHERE "channel_message"."client_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_external_unique" ON "channel_message" USING btree ("organization_id","external_source","external_id") WHERE "channel_message"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_message_root_index_unique" ON "channel_message" USING btree ("channel_id","root_index") WHERE "channel_message"."root_index" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_message_thread_idx" ON "channel_message" USING btree ("thread_root_id","sequence") WHERE "channel_message"."thread_root_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "channel_message_search_idx" ON "channel_message" USING gin (to_tsvector('simple', "body")) WHERE "channel_message"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "channel_message_revision_message_idx" ON "channel_message_revision" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_promotion_mutation_unique" ON "channel_promotion" USING btree ("organization_id","mutation_id");--> statement-breakpoint
CREATE INDEX "channel_promotion_message_idx" ON "channel_promotion" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "channel_promotion_work_item_idx" ON "channel_promotion" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "channel_reaction_message_idx" ON "channel_reaction" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "channel_reaction_channel_idx" ON "channel_reaction" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_thread_participant_user_idx" ON "channel_thread_participant" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_channel_id_channel_organization_id_id_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channel"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_object_channel_idx" ON "file_object" USING btree ("organization_id","channel_id") WHERE "file_object"."channel_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_one_owner" CHECK (("file_object"."work_item_id" IS NOT NULL AND "file_object"."project_id" IS NOT NULL AND "file_object"."page_id" IS NULL AND "file_object"."channel_id" IS NULL)
        OR ("file_object"."work_item_id" IS NULL AND "file_object"."project_id" IS NULL AND "file_object"."page_id" IS NOT NULL AND "file_object"."channel_id" IS NULL)
        OR ("file_object"."work_item_id" IS NULL AND "file_object"."project_id" IS NULL AND "file_object"."page_id" IS NULL AND "file_object"."channel_id" IS NOT NULL));