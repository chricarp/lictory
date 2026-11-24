CREATE TYPE "public"."agent_approval_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."agent_kind" AS ENUM('runner', 'external', 'intelligence');--> statement-breakpoint
CREATE TYPE "public"."agent_session_status" AS ENUM('queued', 'assigned', 'running', 'waiting', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"avatar" text,
	"owner_id" text NOT NULL,
	"kind" "agent_kind" NOT NULL,
	"harness" text,
	"model" text,
	"instructions" text DEFAULT '' NOT NULL,
	"access" text DEFAULT 'write' NOT NULL,
	"project_ids" text[],
	"shared" boolean DEFAULT false NOT NULL,
	"default_runner_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "agent_access" CHECK ("agent"."access" in ('read', 'write')),
	CONSTRAINT "agent_handle_format" CHECK ("agent"."handle" ~ '^[a-z][a-z0-9_]{2,29}$'),
	CONSTRAINT "agent_name_present" CHECK (length(trim("agent"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_approval" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"request_key" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb NOT NULL,
	"status" "agent_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"runner_id" text,
	"requested_runner_id" text,
	"requested_by_id" text NOT NULL,
	"status" "agent_session_status" DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"work_item_id" text,
	"project_id" text,
	"repository_url" text,
	"base_branch" text,
	"branch" text,
	"channel_id" text,
	"thread_root_message_id" text,
	"result_summary" text,
	"pull_request_id" text,
	"pull_request_url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"event_sequence" integer DEFAULT 0 NOT NULL,
	"runner_sequence" integer DEFAULT 0 NOT NULL,
	"input_sequence" integer DEFAULT 0 NOT NULL,
	"input_cursor" integer DEFAULT 0 NOT NULL,
	"access_token_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_session_attempts" CHECK ("agent_session"."max_attempts" between 1 and 10 and "agent_session"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_session_event" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_session_event_session_id_sequence_pk" PRIMARY KEY("session_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "agent_session_input" (
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_session_input_session_id_sequence_pk" PRIMARY KEY("session_id","sequence"),
	CONSTRAINT "agent_session_input_kind" CHECK ("agent_session_input"."kind" in ('message', 'interrupt', 'cancel', 'approval_answer'))
);
--> statement-breakpoint
CREATE TABLE "factory_entity" (
	"key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_prefix" text NOT NULL,
	"os" text DEFAULT '' NOT NULL,
	"arch" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"hostname" text DEFAULT '' NOT NULL,
	"harnesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"max_sessions" integer DEFAULT 2 NOT NULL,
	"isolation" text DEFAULT 'host' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" text,
	CONSTRAINT "runner_isolation" CHECK ("runner"."isolation" in ('host', 'container')),
	CONSTRAINT "runner_max_sessions" CHECK ("runner"."max_sessions" between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "runner_registration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"runner_id" text
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "access_token" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_default_runner_id_runner_id_fk" FOREIGN KEY ("default_runner_id") REFERENCES "public"."runner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval" ADD CONSTRAINT "agent_approval_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_runner_id_runner_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_requested_runner_id_runner_id_fk" FOREIGN KEY ("requested_runner_id") REFERENCES "public"."runner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_event" ADD CONSTRAINT "agent_session_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_event" ADD CONSTRAINT "agent_session_event_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_input" ADD CONSTRAINT "agent_session_input_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_input" ADD CONSTRAINT "agent_session_input_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_input" ADD CONSTRAINT "agent_session_input_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_entity" ADD CONSTRAINT "factory_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_revoked_by_id_user_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_runner_id_runner_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_handle_idx" ON "agent" USING btree ("organization_id","handle");--> statement-breakpoint
CREATE INDEX "agent_owner_idx" ON "agent" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_approval_request_idx" ON "agent_approval" USING btree ("session_id","request_key");--> statement-breakpoint
CREATE INDEX "agent_approval_pending_idx" ON "agent_approval" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "agent_session_queue_idx" ON "agent_session" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_runner_idx" ON "agent_session" USING btree ("runner_id","status");--> statement-breakpoint
CREATE INDEX "agent_session_lease_idx" ON "agent_session" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "agent_session_agent_idx" ON "agent_session" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "factory_entity_scope_idx" ON "factory_entity" USING btree ("organization_id","type","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_credential_idx" ON "runner" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "runner_organization_idx" ON "runner" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runner_registration_token_idx" ON "runner_registration" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "runner_registration_organization_idx" ON "runner_registration" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_agent_session_id_agent_session_id_fk" FOREIGN KEY ("agent_session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_token_agent_idx" ON "access_token" USING btree ("agent_id");