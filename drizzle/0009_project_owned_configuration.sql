CREATE TYPE "public"."project_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "discipline" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"can_edit_specifications" boolean DEFAULT false NOT NULL,
	"can_change_properties" boolean DEFAULT false NOT NULL,
	"can_request_reviews" boolean DEFAULT false NOT NULL,
	"can_review" boolean DEFAULT false NOT NULL,
	"can_publish_delivery" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "discipline_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "discipline_project_id_unique" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "discipline_name_present" CHECK (length(trim("discipline"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "discipline_member" (
	"organization_id" text NOT NULL,
	"discipline_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discipline_member_discipline_id_user_id_pk" PRIMARY KEY("discipline_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_work_item_type" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"type_id" text NOT NULL,
	CONSTRAINT "project_work_item_type_project_id_type_id_pk" PRIMARY KEY("project_id","type_id")
);
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_status_fk";
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_iteration_fk";
--> statement-breakpoint
DROP INDEX "delivery_target_org_default_unique";--> statement-breakpoint
DROP INDEX "delivery_target_team_unique";--> statement-breakpoint
ALTER TABLE "iteration" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_status" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_target" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "iteration" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "delivery_mode" "delivery_mode" DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "readiness_policy" "readiness_policy" DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "estimate_scale" "estimate_scale" DEFAULT 'fibonacci' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "iteration_mode" "iteration_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "iteration_weeks" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "iteration_start_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "upcoming_iterations" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ai_action_policy" "ai_action_policy" DEFAULT 'advisory' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "discipline_id" text;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD COLUMN "discipline_id" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD COLUMN "external_status_category" text;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD COLUMN "external_assignee" text;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD COLUMN "external_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_status" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "discipline" ADD CONSTRAINT "discipline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline" ADD CONSTRAINT "discipline_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_member" ADD CONSTRAINT "discipline_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_member" ADD CONSTRAINT "discipline_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_member" ADD CONSTRAINT "discipline_member_organization_id_discipline_id_discipline_organization_id_id_fk" FOREIGN KEY ("organization_id","discipline_id") REFERENCES "public"."discipline"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_work_item_type" ADD CONSTRAINT "project_work_item_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_work_item_type" ADD CONSTRAINT "project_work_item_type_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_work_item_type" ADD CONSTRAINT "project_work_item_type_organization_id_type_id_work_item_type_organization_id_id_fk" FOREIGN KEY ("organization_id","type_id") REFERENCES "public"."work_item_type"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discipline_project_active_name_unique" ON "discipline" USING btree ("organization_id","project_id",lower("name")) WHERE "discipline"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "discipline_member_org_user_idx" ON "discipline_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "project_member_org_user_idx" ON "project_member" USING btree ("organization_id","user_id");