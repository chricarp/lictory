CREATE TYPE "public"."page_thread_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "page_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"author_id" text NOT NULL,
	"status" "page_thread_status" DEFAULT 'open' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"anchor" jsonb NOT NULL,
	"commit_id" text,
	"branch_id" text,
	"pull_request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	CONSTRAINT "page_thread_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_thread_page_id_unique" UNIQUE("organization_id","page_id","id"),
	CONSTRAINT "page_thread_anchor_kind" CHECK (coalesce("page_thread"."anchor"->>'v', '') = '1'
        AND coalesce("page_thread"."anchor"->>'kind', '') IN ('commit', 'draft', 'page')),
	CONSTRAINT "page_thread_commit_anchor" CHECK ("page_thread"."anchor"->>'kind' <> 'commit'
        OR ("page_thread"."commit_id" IS NOT NULL AND "page_thread"."commit_id" = "page_thread"."anchor"->>'commitId')),
	CONSTRAINT "page_thread_draft_anchor" CHECK ("page_thread"."anchor"->>'kind' <> 'draft' OR "page_thread"."branch_id" IS NOT NULL),
	CONSTRAINT "page_thread_resolution" CHECK (("page_thread"."status" = 'resolved') = ("page_thread"."resolved_at" IS NOT NULL)
        AND ("page_thread"."resolved_at" IS NULL) = ("page_thread"."resolved_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_thread_message_body_present" CHECK (length(trim("page_thread_message"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "file_object" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ALTER COLUMN "work_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "page_activity" ADD CONSTRAINT "page_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_activity" ADD CONSTRAINT "page_activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_activity" ADD CONSTRAINT "page_activity_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_organization_id_page_id_commit_id_page_commit_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread" ADD CONSTRAINT "page_thread_organization_id_page_id_branch_id_page_branch_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","branch_id") REFERENCES "public"."page_branch"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread_message" ADD CONSTRAINT "page_thread_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread_message" ADD CONSTRAINT "page_thread_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_thread_message" ADD CONSTRAINT "page_thread_message_organization_id_thread_id_page_thread_organization_id_id_fk" FOREIGN KEY ("organization_id","thread_id") REFERENCES "public"."page_thread"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_activity_page_idx" ON "page_activity" USING btree ("organization_id","page_id","created_at");--> statement-breakpoint
CREATE INDEX "page_thread_page_idx" ON "page_thread" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE INDEX "page_thread_pull_request_idx" ON "page_thread" USING btree ("organization_id","pull_request_id") WHERE "page_thread"."pull_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "page_thread_message_thread_idx" ON "page_thread_message" USING btree ("organization_id","thread_id","created_at");--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_object_page_idx" ON "file_object" USING btree ("organization_id","page_id") WHERE "file_object"."page_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_one_owner" CHECK (("file_object"."work_item_id" IS NOT NULL AND "file_object"."project_id" IS NOT NULL AND "file_object"."page_id" IS NULL)
        OR ("file_object"."work_item_id" IS NULL AND "file_object"."project_id" IS NULL AND "file_object"."page_id" IS NOT NULL));