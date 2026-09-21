-- Physical rename: proposal → work_item, proposal_id → work_item_id. Pure
-- renames preserve every row, revision, approval and sync change. Constraint and
-- index names are renamed to what the schema snapshot expects.
ALTER TABLE "proposal" RENAME TO "work_item";--> statement-breakpoint
ALTER TABLE "specification_revision" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "review" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "thread" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "suggestion" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "approval" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "readiness_check" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "decision" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "delivery_item" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "activity" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER TABLE "sync_change" RENAME COLUMN "proposal_id" TO "work_item_id";--> statement-breakpoint
ALTER INDEX "proposal_product_status_idx" RENAME TO "work_item_product_status_idx";--> statement-breakpoint
ALTER INDEX "proposal_creator_idx" RENAME TO "work_item_creator_idx";--> statement-breakpoint
ALTER INDEX "thread_proposal_status_idx" RENAME TO "thread_item_status_idx";--> statement-breakpoint
ALTER INDEX "decision_proposal_idx" RENAME TO "decision_item_idx";--> statement-breakpoint
ALTER INDEX "activity_proposal_idx" RENAME TO "activity_item_idx";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "proposal_organization_id_organization_id_fk" TO "work_item_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "proposal_assignee_id_user_id_fk" TO "work_item_assignee_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "proposal_created_by_id_user_id_fk" TO "work_item_created_by_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "proposal_organization_id_product_id_product_organization_id_id_fk" TO "work_item_organization_id_product_id_product_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "approval" RENAME CONSTRAINT "approval_organization_id_proposal_id_revision_id_review_id_review_organization_id_proposal_id_revision_id_id_fk" TO "approval_organization_id_work_item_id_revision_id_review_id_review_organization_id_work_item_id_revision_id_id_fk";--> statement-breakpoint
ALTER TABLE "decision" RENAME CONSTRAINT "decision_organization_id_product_id_proposal_id_proposal_organization_id_product_id_id_fk" TO "decision_organization_id_product_id_work_item_id_work_item_organization_id_product_id_id_fk";--> statement-breakpoint
ALTER TABLE "decision" RENAME CONSTRAINT "decision_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "decision_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "decision" RENAME CONSTRAINT "decision_organization_id_proposal_id_revision_id_source_thread_id_thread_organization_id_proposal_id_revision_id_id_fk" TO "decision_organization_id_work_item_id_revision_id_source_thread_id_thread_organization_id_work_item_id_revision_id_id_fk";--> statement-breakpoint
ALTER TABLE "delivery_item" RENAME CONSTRAINT "delivery_item_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "delivery_item_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "readiness_check" RENAME CONSTRAINT "readiness_check_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "readiness_check_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "review" RENAME CONSTRAINT "review_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "review_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "specification_revision" RENAME CONSTRAINT "specification_revision_organization_id_proposal_id_proposal_organization_id_id_fk" TO "specification_revision_organization_id_work_item_id_work_item_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "suggestion" RENAME CONSTRAINT "suggestion_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "suggestion_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "suggestion" RENAME CONSTRAINT "suggestion_organization_id_proposal_id_revision_id_thread_id_thread_organization_id_proposal_id_revision_id_id_fk" TO "suggestion_organization_id_work_item_id_revision_id_thread_id_thread_organization_id_work_item_id_revision_id_id_fk";--> statement-breakpoint
ALTER TABLE "suggestion" RENAME CONSTRAINT "suggestion_organization_id_proposal_id_accepted_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "suggestion_organization_id_work_item_id_accepted_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "thread" RENAME CONSTRAINT "thread_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" TO "thread_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk";--> statement-breakpoint
ALTER TABLE "thread" RENAME CONSTRAINT "thread_organization_id_proposal_id_revision_id_review_id_review_organization_id_proposal_id_revision_id_id_fk" TO "thread_organization_id_work_item_id_revision_id_review_id_review_organization_id_work_item_id_revision_id_id_fk";--> statement-breakpoint
-- Labels, milestones and manual ordering.
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "label" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "label_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "label_product_name_unique" UNIQUE("organization_id","product_id","name")
);--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"name" text NOT NULL,
	"target_date" timestamp,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "milestone_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "milestone_product_name_unique" UNIQUE("organization_id","product_id","name")
);--> statement-breakpoint
CREATE TABLE "work_item_label" (
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"label_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_label_work_item_id_label_id_pk" PRIMARY KEY("work_item_id","label_id")
);--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_product_id_product_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_product_id_product_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_label_id_label_organization_id_id_fk" FOREIGN KEY ("organization_id","label_id") REFERENCES "public"."label"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_label_label_idx" ON "work_item_label" USING btree ("organization_id","label_id");--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "milestone_id" text;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing siblings keep creation order as their initial manual order.
WITH ordered AS (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY organization_id, product_id, parent_id ORDER BY created_at, id) * 1000)::int AS pos FROM work_item
)
UPDATE work_item w SET position = ordered.pos FROM ordered WHERE ordered.id = w.id;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_milestone_fk" FOREIGN KEY ("organization_id","milestone_id") REFERENCES "public"."milestone"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_milestone_idx" ON "work_item" USING btree ("organization_id","milestone_id");
