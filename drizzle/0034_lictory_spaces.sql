CREATE TYPE "public"."space_access_level" AS ENUM('view', 'comment', 'edit');--> statement-breakpoint
CREATE TYPE "public"."space_access_mode" AS ENUM('inherited', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."space_publishing" AS ENUM('direct', 'reviewed');--> statement-breakpoint
CREATE TABLE "page" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"parent_id" text,
	"rank" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"archived_by_id" text,
	CONSTRAINT "page_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_space_id_unique" UNIQUE("organization_id","space_id","id"),
	CONSTRAINT "page_not_own_parent" CHECK ("page"."parent_id" IS NULL OR "page"."parent_id" <> "page"."id"),
	CONSTRAINT "page_archive_consistent" CHECK (("page"."archived_at" IS NULL) = ("page"."archived_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_branch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"name" text NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"head_commit_id" text NOT NULL,
	"base_commit_id" text,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "page_branch_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_branch_page_id_unique" UNIQUE("organization_id","page_id","id"),
	CONSTRAINT "page_branch_main_kept" CHECK (NOT ("page_branch"."is_main" AND "page_branch"."deleted_at" IS NOT NULL)),
	CONSTRAINT "page_branch_delete_consistent" CHECK (("page_branch"."deleted_at" IS NULL) = ("page_branch"."deleted_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_branch_collaborator" (
	"organization_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_branch_collaborator_branch_id_user_id_pk" PRIMARY KEY("branch_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "page_commit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"parent_ids" text[] DEFAULT '{}' NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"message" text,
	"author_id" text NOT NULL,
	"contributor_ids" text[] DEFAULT '{}' NOT NULL,
	"draft_id" text,
	"draft_epoch" integer,
	"draft_sequence" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "page_commit_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "page_commit_page_id_unique" UNIQUE("organization_id","page_id","id"),
	CONSTRAINT "page_commit_title_present" CHECK (length(trim("page_commit"."title")) > 0),
	CONSTRAINT "page_commit_schema_version" CHECK ("page_commit"."schema_version" > 0),
	CONSTRAINT "page_commit_draft_provenance" CHECK (("page_commit"."draft_id" IS NULL AND "page_commit"."draft_epoch" IS NULL AND "page_commit"."draft_sequence" IS NULL)
        OR ("page_commit"."draft_id" IS NOT NULL AND "page_commit"."draft_epoch" IS NOT NULL AND "page_commit"."draft_sequence" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "space" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"project_id" text,
	"team_id" text,
	"access_mode" "space_access_mode" DEFAULT 'inherited' NOT NULL,
	"publishing" "space_publishing" DEFAULT 'direct' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"archived_by_id" text,
	CONSTRAINT "space_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "space_team_needs_project" CHECK ("space"."team_id" IS NULL OR "space"."project_id" IS NOT NULL),
	CONSTRAINT "space_name_present" CHECK (length(trim("space"."name")) > 0),
	CONSTRAINT "space_slug_format" CHECK ("space"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "space_archive_consistent" CHECK (("space"."archived_at" IS NULL) = ("space"."archived_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "space_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"epoch" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"committed_sequence" integer DEFAULT 0 NOT NULL,
	"base_commit_id" text NOT NULL,
	"snapshot" "bytea",
	"snapshot_sequence" integer DEFAULT 0 NOT NULL,
	"fenced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "space_draft_branch_unique" UNIQUE("branch_id"),
	CONSTRAINT "space_draft_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "space_draft_epoch_positive" CHECK ("space_draft"."epoch" > 0),
	CONSTRAINT "space_draft_sequences" CHECK ("space_draft"."sequence" >= 0 AND "space_draft"."committed_sequence" >= 0 AND "space_draft"."snapshot_sequence" >= 0
        AND "space_draft"."committed_sequence" <= "space_draft"."sequence" AND "space_draft"."snapshot_sequence" <= "space_draft"."sequence")
);
--> statement-breakpoint
CREATE TABLE "space_draft_update" (
	"organization_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"sequence" integer NOT NULL,
	"author_id" text NOT NULL,
	"digest" "bytea" NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "space_draft_update_draft_id_sequence_pk" PRIMARY KEY("draft_id","sequence"),
	CONSTRAINT "space_draft_update_digest_unique" UNIQUE("draft_id","epoch","digest")
);
--> statement-breakpoint
CREATE TABLE "space_entity" (
	"key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"page_id" text,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_grant" (
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"level" "space_access_level" NOT NULL,
	"granted_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "space_grant_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "space_reader" (
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"level" "space_access_level" NOT NULL,
	CONSTRAINT "space_reader_space_id_user_id_pk" PRIMARY KEY("space_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_archived_by_id_user_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_organization_id_space_id_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_organization_id_space_id_parent_id_page_organization_id_space_id_id_fk" FOREIGN KEY ("organization_id","space_id","parent_id") REFERENCES "public"."page"("organization_id","space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_deleted_by_id_user_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_organization_id_page_id_head_commit_id_page_commit_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","head_commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch" ADD CONSTRAINT "page_branch_organization_id_page_id_base_commit_id_page_commit_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","base_commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch_collaborator" ADD CONSTRAINT "page_branch_collaborator_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch_collaborator" ADD CONSTRAINT "page_branch_collaborator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_branch_collaborator" ADD CONSTRAINT "page_branch_collaborator_organization_id_branch_id_page_branch_organization_id_id_fk" FOREIGN KEY ("organization_id","branch_id") REFERENCES "public"."page_branch"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_commit" ADD CONSTRAINT "page_commit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_commit" ADD CONSTRAINT "page_commit_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_commit" ADD CONSTRAINT "page_commit_organization_id_page_id_page_organization_id_id_fk" FOREIGN KEY ("organization_id","page_id") REFERENCES "public"."page"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_archived_by_id_user_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_organization_id_project_id_team_id_team_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","team_id") REFERENCES "public"."team"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft" ADD CONSTRAINT "space_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft" ADD CONSTRAINT "space_draft_organization_id_page_id_branch_id_page_branch_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","branch_id") REFERENCES "public"."page_branch"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft" ADD CONSTRAINT "space_draft_organization_id_page_id_base_commit_id_page_commit_organization_id_page_id_id_fk" FOREIGN KEY ("organization_id","page_id","base_commit_id") REFERENCES "public"."page_commit"("organization_id","page_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft_update" ADD CONSTRAINT "space_draft_update_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft_update" ADD CONSTRAINT "space_draft_update_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft_update" ADD CONSTRAINT "space_draft_update_organization_id_draft_id_space_draft_organization_id_id_fk" FOREIGN KEY ("organization_id","draft_id") REFERENCES "public"."space_draft"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_entity" ADD CONSTRAINT "space_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_grant" ADD CONSTRAINT "space_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_grant" ADD CONSTRAINT "space_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_grant" ADD CONSTRAINT "space_grant_granted_by_id_user_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_grant" ADD CONSTRAINT "space_grant_organization_id_space_id_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reader" ADD CONSTRAINT "space_reader_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reader" ADD CONSTRAINT "space_reader_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reader" ADD CONSTRAINT "space_reader_organization_id_space_id_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."space"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_space_tree_idx" ON "page" USING btree ("organization_id","space_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_branch_one_main" ON "page_branch" USING btree ("page_id") WHERE "page_branch"."is_main";--> statement-breakpoint
CREATE UNIQUE INDEX "page_branch_active_name_unique" ON "page_branch" USING btree ("organization_id","page_id",lower("name")) WHERE "page_branch"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "page_commit_page_idx" ON "page_commit" USING btree ("organization_id","page_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "space_active_slug_unique" ON "space" USING btree ("organization_id",lower("slug")) WHERE "space"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "space_org_project_idx" ON "space" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "space_entity_scope_idx" ON "space_entity" USING btree ("organization_id","space_id","page_id","type");--> statement-breakpoint
CREATE INDEX "space_grant_org_user_idx" ON "space_grant" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "space_reader_org_user_idx" ON "space_reader" USING btree ("organization_id","user_id");