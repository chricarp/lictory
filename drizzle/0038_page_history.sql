CREATE TYPE "public"."page_pull_request_status" AS ENUM('draft', 'open', 'merged');--> statement-breakpoint
CREATE TYPE "public"."page_review_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TABLE "page_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"source_branch_id" text NOT NULL,
	"target_branch_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "page_pull_request_status" DEFAULT 'open' NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"merged_at" timestamp,
	"merged_by_id" text,
	"merge_commit_id" text,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "page_pull_request_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_pull_request_page_id_unique" UNIQUE("organization_id","page_id","id"),
	CONSTRAINT "page_pull_request_branches" CHECK ("page_pull_request"."source_branch_id" <> "page_pull_request"."target_branch_id"),
	CONSTRAINT "page_pull_request_title_present" CHECK (length(trim("page_pull_request"."title")) > 0),
	CONSTRAINT "page_pull_request_merge_consistent" CHECK (("page_pull_request"."status" = 'merged') = ("page_pull_request"."merged_at" IS NOT NULL)
        AND ("page_pull_request"."merged_at" IS NULL) = ("page_pull_request"."merged_by_id" IS NULL)
        AND ("page_pull_request"."merged_at" IS NULL) = ("page_pull_request"."merge_commit_id" IS NULL)),
	CONSTRAINT "page_pull_request_delete_consistent" CHECK (("page_pull_request"."deleted_at" IS NULL) = ("page_pull_request"."deleted_by_id" IS NULL)
        AND ("page_pull_request"."deleted_at" IS NULL OR "page_pull_request"."status" <> 'merged'))
);
--> statement-breakpoint
CREATE TABLE "page_pull_request_review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"decision" "page_review_decision" NOT NULL,
	"result_hash" text NOT NULL,
	"source_head_id" text NOT NULL,
	"target_head_id" text NOT NULL,
	"stale_at" timestamp,
	"stale_reason" text,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_pull_request_review_stale" CHECK (("page_pull_request_review"."stale_at" IS NULL) = ("page_pull_request_review"."stale_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_pull_request_reviewer" (
	"organization_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"requested_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_pull_request_reviewer_pull_request_id_user_id_pk" PRIMARY KEY("pull_request_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "page_thread" DROP CONSTRAINT "page_thread_anchor_kind";--> statement-breakpoint
ALTER TABLE "page_thread" DROP CONSTRAINT "page_thread_commit_anchor";--> statement-breakpoint
ALTER TABLE "page_commit" ADD COLUMN "pull_request_id" text;--> statement-breakpoint
ALTER TABLE "page_commit" ADD COLUMN "approver_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_merged_by_id_user_id_fk" FOREIGN KEY ("merged_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_organization_id_page_id_source_branch_id_page_branch_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","source_branch_id") REFERENCES "public"."page_branch"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_organization_id_page_id_target_branch_id_page_branch_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","target_branch_id") REFERENCES "public"."page_branch"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request" ADD CONSTRAINT "page_pull_request_organization_id_page_id_merge_commit_id_page_commit_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","merge_commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_review" ADD CONSTRAINT "page_pull_request_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_review" ADD CONSTRAINT "page_pull_request_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_review" ADD CONSTRAINT "page_pull_request_review_organization_id_pull_request_id_page_pull_request_organization_id_id_fk" FOREIGN KEY ("organization_id","pull_request_id") REFERENCES "public"."page_pull_request"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_reviewer" ADD CONSTRAINT "page_pull_request_reviewer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_reviewer" ADD CONSTRAINT "page_pull_request_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_reviewer" ADD CONSTRAINT "page_pull_request_reviewer_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_pull_request_reviewer" ADD CONSTRAINT "page_pull_request_reviewer_organization_id_pull_request_id_page_pull_request_organization_id_id_fk" FOREIGN KEY ("organization_id","pull_request_id") REFERENCES "public"."page_pull_request"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_pull_request_page_idx" ON "page_pull_request" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE INDEX "page_pull_request_review_pr_idx" ON "page_pull_request_review" USING btree ("organization_id","pull_request_id");--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_organization_id_page_id_pull_request_id_page_pull_request_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","pull_request_id") REFERENCES "public"."page_pull_request"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_anchor_kind" CHECK (coalesce("page_thread"."anchor"->>'v', '') = '1'
        AND coalesce("page_thread"."anchor"->>'kind', '') IN ('commit', 'draft', 'page', 'detached'));--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_commit_anchor" CHECK ("page_thread"."anchor"->>'kind' NOT IN ('commit', 'detached')
        OR ("page_thread"."commit_id" IS NOT NULL AND "page_thread"."commit_id" = "page_thread"."anchor"->>'commitId'));