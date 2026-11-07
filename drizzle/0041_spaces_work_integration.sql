CREATE TYPE "public"."page_attachment_purpose" AS ENUM('background', 'design', 'runbook');--> statement-breakpoint
CREATE TYPE "public"."reference_kind" AS ENUM('item', 'page', 'decision');--> statement-breakpoint
CREATE TABLE "page_branch_origin" (
	"organization_id" text NOT NULL,
	"branch_id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_context_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text,
	"iteration_id" text,
	"page_id" text NOT NULL,
	"rank" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"removed_at" timestamp,
	"removed_by_id" text,
	CONSTRAINT "page_context_link_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_context_link_one_scope" CHECK ("page_context_link"."team_id" IS NULL OR "page_context_link"."iteration_id" IS NULL),
	CONSTRAINT "page_context_link_remove_consistent" CHECK (("page_context_link"."removed_at" IS NULL) = ("page_context_link"."removed_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_reference" (
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"commit_id" text NOT NULL,
	"position" integer NOT NULL,
	"block_id" text,
	"kind" "reference_kind" NOT NULL,
	"target_id" text NOT NULL,
	"target_commit_id" text,
	CONSTRAINT "page_reference_page_id_position_pk" PRIMARY KEY("page_id","position"),
	CONSTRAINT "page_reference_position" CHECK ("page_reference"."position" >= 0),
	CONSTRAINT "page_reference_pin" CHECK ("page_reference"."target_commit_id" IS NULL OR "page_reference"."kind" = 'page')
);
--> statement-breakpoint
CREATE TABLE "specification_reference" (
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "reference_kind" NOT NULL,
	"target_id" text NOT NULL,
	"target_commit_id" text,
	CONSTRAINT "specification_reference_revision_id_position_pk" PRIMARY KEY("revision_id","position"),
	CONSTRAINT "specification_reference_position" CHECK ("specification_reference"."position" >= 0),
	CONSTRAINT "specification_reference_pin" CHECK ("specification_reference"."target_commit_id" IS NULL OR "specification_reference"."kind" = 'page')
);
--> statement-breakpoint
CREATE TABLE "work_item_page_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"page_id" text NOT NULL,
	"purpose" "page_attachment_purpose" NOT NULL,
	"commit_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"detached_at" timestamp,
	"detached_by_id" text,
	CONSTRAINT "work_item_page_attachment_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_item_page_attachment_detach_consistent" CHECK (("work_item_page_attachment"."detached_at" IS NULL) = ("work_item_page_attachment"."detached_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "work_item_page_source" (
	"organization_id" text NOT NULL,
	"work_item_id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"commit_id" text NOT NULL,
	"block_id" text,
	"quote" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_page_source_quote_length" CHECK ("work_item_page_source"."quote" IS NULL OR length("work_item_page_source"."quote") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "space_entity" ADD COLUMN "work_item_id" text;--> statement-breakpoint
ALTER TABLE "space_entity" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "page_branch_origin" ADD CONSTRAINT "page_branch_origin_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch_origin" ADD CONSTRAINT "page_branch_origin_branch_fk" FOREIGN KEY ("organization_id","page_id","branch_id") REFERENCES "public"."page_branch"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch_origin" ADD CONSTRAINT "page_branch_origin_revision_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_removed_by_id_user_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_team_fk" FOREIGN KEY ("organization_id","project_id","team_id") REFERENCES "public"."team"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_iteration_fk" FOREIGN KEY ("organization_id","project_id","iteration_id") REFERENCES "public"."iteration"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_context_link" ADD CONSTRAINT "page_context_link_page_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reference" ADD CONSTRAINT "page_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reference" ADD CONSTRAINT "page_reference_commit_fk" FOREIGN KEY ("organization_id","page_id","commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_reference" ADD CONSTRAINT "specification_reference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_reference" ADD CONSTRAINT "specification_reference_revision_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_detached_by_id_user_id_fk" FOREIGN KEY ("detached_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_page_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_attachment" ADD CONSTRAINT "work_item_page_attachment_commit_fk" FOREIGN KEY ("organization_id","page_id","commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_source" ADD CONSTRAINT "work_item_page_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_source" ADD CONSTRAINT "work_item_page_source_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_source" ADD CONSTRAINT "work_item_page_source_item_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_page_source" ADD CONSTRAINT "work_item_page_source_commit_fk" FOREIGN KEY ("organization_id","page_id","commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_branch_origin_item_idx" ON "page_branch_origin" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "page_branch_origin_page_idx" ON "page_branch_origin" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_context_link_active_unique" ON "page_context_link" USING btree ("organization_id","project_id",coalesce("team_id", ''),coalesce("iteration_id", ''),"page_id") WHERE "page_context_link"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "page_context_link_project_idx" ON "page_context_link" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "page_context_link_page_idx" ON "page_context_link" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE INDEX "page_reference_target_idx" ON "page_reference" USING btree ("organization_id","kind","target_id");--> statement-breakpoint
CREATE INDEX "specification_reference_target_idx" ON "specification_reference" USING btree ("organization_id","kind","target_id");--> statement-breakpoint
CREATE INDEX "specification_reference_item_idx" ON "specification_reference" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_page_attachment_active_unique" ON "work_item_page_attachment" USING btree ("organization_id","work_item_id","page_id") WHERE "work_item_page_attachment"."detached_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_item_page_attachment_item_idx" ON "work_item_page_attachment" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_page_attachment_page_idx" ON "work_item_page_attachment" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE INDEX "work_item_page_source_page_idx" ON "work_item_page_source" USING btree ("organization_id","page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revision_title_trgm_idx" ON "specification_revision" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revision_content_trgm_idx" ON "specification_revision" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_commit_title_trgm_idx" ON "page_commit" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_commit_markdown_trgm_idx" ON "page_commit" USING gin ("markdown" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "space_entity_work_item_idx" ON "space_entity" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "space_entity_project_idx" ON "space_entity" USING btree ("organization_id","project_id");