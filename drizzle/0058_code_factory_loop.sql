CREATE TYPE "public"."code_lictory_review_decision" AS ENUM('approve', 'request_changes');--> statement-breakpoint
CREATE TABLE "code_review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"decision" "code_lictory_review_decision" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reviewer_id" text NOT NULL,
	"agent_id" text,
	"agent_name" text,
	"agent_session_id" text,
	"superseded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "repository_id" text;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD COLUMN "merge_requested_by_id" text;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD COLUMN "merged_via" text;--> statement-breakpoint
ALTER TABLE "code_repository_project" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "code_write" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "code_write" ADD COLUMN "agent_session_id" text;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_review" ADD CONSTRAINT "code_review_organization_id_pull_request_id_code_pull_request_organization_id_id_fk" FOREIGN KEY ("organization_id","pull_request_id") REFERENCES "public"."code_pull_request"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_review_pull_request_idx" ON "code_review" USING btree ("organization_id","pull_request_id","head_sha");--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD CONSTRAINT "code_pull_request_merge_requested_by_id_user_id_fk" FOREIGN KEY ("merge_requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_repository_project_default_unique" ON "code_repository_project" USING btree ("organization_id","project_id") WHERE "code_repository_project"."is_default";