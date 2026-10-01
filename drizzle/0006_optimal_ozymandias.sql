CREATE TABLE "pull_request_review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"pull_request_id" text NOT NULL,
	"role_id" text NOT NULL,
	"user_id" text,
	"required" boolean DEFAULT true NOT NULL,
	"decision" text,
	"reviewer_id" text,
	"result_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pr_review_role_unique" UNIQUE("pull_request_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "specification_branch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"name" text NOT NULL,
	"head_id" text NOT NULL,
	"author_id" text NOT NULL,
	"collaborator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "branch_context_unique" UNIQUE("organization_id","work_item_id","id")
);
--> statement-breakpoint
CREATE TABLE "specification_commit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"parent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text NOT NULL,
	"author_id" text NOT NULL,
	"revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "commit_context_unique" UNIQUE("organization_id","work_item_id","id")
);
--> statement-breakpoint
CREATE TABLE "specification_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_id" text NOT NULL,
	"merged_commit_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "pr_context_unique" UNIQUE("organization_id","work_item_id","id"),
	CONSTRAINT "pr_different_branches" CHECK ("specification_pull_request"."source_id" <> "specification_pull_request"."target_id"),
	CONSTRAINT "pr_valid_status" CHECK ("specification_pull_request"."status" in ('draft','open','merged'))
);
--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "pull_request_id" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "commit_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_work_item_id_pull_request_id_specification_pull_request_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","pull_request_id") REFERENCES "public"."specification_pull_request"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_role_id_organization_role_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."organization_role"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_branch" ADD CONSTRAINT "specification_branch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_branch" ADD CONSTRAINT "specification_branch_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_branch" ADD CONSTRAINT "specification_branch_organization_id_work_item_id_head_id_specification_commit_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","head_id") REFERENCES "public"."specification_commit"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_commit" ADD CONSTRAINT "specification_commit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_commit" ADD CONSTRAINT "specification_commit_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_commit" ADD CONSTRAINT "specification_commit_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_commit" ADD CONSTRAINT "specification_commit_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_pull_request" ADD CONSTRAINT "specification_pull_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_pull_request" ADD CONSTRAINT "specification_pull_request_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_pull_request" ADD CONSTRAINT "specification_pull_request_organization_id_work_item_id_source_id_specification_branch_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","source_id") REFERENCES "public"."specification_branch"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_pull_request" ADD CONSTRAINT "specification_pull_request_organization_id_work_item_id_target_id_specification_branch_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","target_id") REFERENCES "public"."specification_branch"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_pull_request" ADD CONSTRAINT "specification_pull_request_organization_id_work_item_id_merged_commit_id_specification_commit_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","merged_commit_id") REFERENCES "public"."specification_commit"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branch_active_name_unique" ON "specification_branch" USING btree ("organization_id","work_item_id","name") WHERE "specification_branch"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "commit_revision_unique" ON "specification_commit" USING btree ("revision_id");--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_pull_request_id_specification_pull_request_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","pull_request_id") REFERENCES "public"."specification_pull_request"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_commit_id_specification_commit_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","commit_id") REFERENCES "public"."specification_commit"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;