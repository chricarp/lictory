CREATE TYPE "public"."agent_event_subscription_kind" AS ENUM('webhook', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."agent_event_subscription_status" AS ENUM('active', 'paused', 'suspended', 'expired');--> statement-breakpoint
CREATE TABLE "agent_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"type" text NOT NULL,
	"source_kind" text NOT NULL,
	"actor_id" text,
	"project_id" text,
	"work_item_id" text,
	"channel_id" text,
	"space_id" text,
	"page_id" text,
	"data" jsonb NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "agent_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "agent_event_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"webhooks_allowed" boolean DEFAULT true NOT NULL,
	"allowed_hosts" text[],
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_event_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "agent_event_subscription_kind" NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"agent_id" text,
	"access_token_id" text,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"previous_secret" text,
	"previous_until" timestamp,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"project_ids" text[],
	"arguments" jsonb,
	"max_age_ms" integer,
	"status" "agent_event_subscription_status" NOT NULL,
	"status_reason" text,
	"cursor_seq" bigint NOT NULL,
	"refresh_before" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"last_error_detail" text,
	"failed_since" timestamp,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_event_subscription_mcp_token" CHECK ("agent_event_subscription"."kind" <> 'mcp' or ("agent_event_subscription"."access_token_id" is not null and "agent_event_subscription"."refresh_before" is not null)),
	CONSTRAINT "agent_event_subscription_name_present" CHECK (length(trim("agent_event_subscription"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_policy" ADD CONSTRAINT "agent_event_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_subscription" ADD CONSTRAINT "agent_event_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_subscription" ADD CONSTRAINT "agent_event_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event_subscription" ADD CONSTRAINT "agent_event_subscription_access_token_id_access_token_id_fk" FOREIGN KEY ("access_token_id") REFERENCES "public"."access_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_event_feed_idx" ON "agent_event" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "agent_event_org_idx" ON "agent_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_event_created_idx" ON "agent_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_event_dedupe_idx" ON "agent_event" USING btree ("user_id","dedupe_key") WHERE "agent_event"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "agent_event_subscription_user_idx" ON "agent_event_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_event_subscription_due_idx" ON "agent_event_subscription" USING btree ("next_attempt_at") WHERE "agent_event_subscription"."status" = 'active';--> statement-breakpoint
CREATE INDEX "agent_event_subscription_token_idx" ON "agent_event_subscription" USING btree ("access_token_id");