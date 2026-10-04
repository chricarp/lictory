CREATE TYPE "public"."ai_action_policy" AS ENUM('off', 'advisory', 'required');--> statement-breakpoint
CREATE TYPE "public"."ai_run_kind" AS ENUM('item_review', 'pr_action');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "ai_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"kind" "ai_run_kind" NOT NULL,
	"status" "ai_run_status" DEFAULT 'queued' NOT NULL,
	"pull_request_id" text,
	"head_commit_id" text,
	"requested_by_id" text NOT NULL,
	"context_revisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"summary" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrective_pull_requests" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"stale_at" timestamp,
	"stale_reason" text,
	CONSTRAINT "ai_run_kind_target" CHECK (("ai_run"."kind" = 'pr_action') = ("ai_run"."pull_request_id" IS NOT NULL)),
	CONSTRAINT "ai_run_score_range" CHECK ("ai_run"."score" IS NULL OR "ai_run"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "organization_ai_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "ai_action_policy" "ai_action_policy" DEFAULT 'advisory' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_pull_request_fk" FOREIGN KEY ("organization_id","work_item_id","pull_request_id") REFERENCES "public"."specification_pull_request"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ai_policy" ADD CONSTRAINT "organization_ai_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ai_policy" ADD CONSTRAINT "organization_ai_policy_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_run_item_idx" ON "ai_run" USING btree ("organization_id","work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_run_pending_idx" ON "ai_run" USING btree ("status","created_at") WHERE "ai_run"."status" in ('queued','running');--> statement-breakpoint
-- Lictory AI authors the commits, pull requests and discussions it proposes.
-- It has no credentials and belongs to no organization.
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ('lictory-ai', 'Lictory AI', 'ai@lictory.invalid', true, now(), now()) ON CONFLICT ("id") DO NOTHING;
