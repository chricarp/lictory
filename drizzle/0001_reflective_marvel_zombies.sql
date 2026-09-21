CREATE TYPE "public"."approval_status" AS ENUM('granted', 'revoked', 'stale');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('pending', 'running', 'passed', 'failed', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."delivery_sync_status" AS ENUM('pending', 'synced', 'failed', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'refinement', 'in_review', 'changes_requested', 'approved', 'delivery_review', 'ready', 'published', 'obsolete');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('requested', 'in_progress', 'changes_requested', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"review_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "approval_status" DEFAULT 'granted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"ended_by_id" text,
	"end_reason" text,
	CONSTRAINT "approval_end_consistent" CHECK (("approval"."status" = 'granted' AND "approval"."ended_at" IS NULL AND "approval"."ended_by_id" IS NULL AND "approval"."end_reason" IS NULL) OR ("approval"."status" <> 'granted' AND "approval"."ended_at" IS NOT NULL AND "approval"."end_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"proposal_id" text,
	"revision_id" text,
	"source_thread_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "decision_source_context" CHECK (("decision"."revision_id" IS NULL OR "decision"."proposal_id" IS NOT NULL) AND ("decision"."source_thread_id" IS NULL OR "decision"."revision_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"delivery_item_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_namespace" text NOT NULL,
	"external_id" text,
	"external_key" text,
	"external_url" text,
	"status" "delivery_sync_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"last_error" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_external_destination_unique" UNIQUE("organization_id","delivery_item_id","provider","external_namespace"),
	CONSTRAINT "delivery_external_identity_unique" UNIQUE("organization_id","provider","external_namespace","external_id"),
	CONSTRAINT "delivery_external_synced_identity" CHECK ("delivery_external_link"."status" <> 'synced' OR ("delivery_external_link"."external_id" IS NOT NULL AND "delivery_external_link"."synced_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"parent_id" text,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "delivery_item_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "delivery_item_context_unique" UNIQUE("organization_id","proposal_id","revision_id","id"),
	CONSTRAINT "delivery_item_not_own_parent" CHECK ("delivery_item"."parent_id" IS NULL OR "delivery_item"."parent_id" <> "delivery_item"."id"),
	CONSTRAINT "delivery_item_position_nonnegative" CHECK ("delivery_item"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "functional_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "group_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "group_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"organization_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "product_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "product_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"problem_statement" text,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "proposal_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "proposal_product_id_unique" UNIQUE("organization_id","product_id","id")
);
--> statement-breakpoint
CREATE TABLE "readiness_check" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"key" text NOT NULL,
	"status" "check_status" DEFAULT 'pending' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"evaluated_by_id" text,
	"evaluator" text NOT NULL,
	"explanation" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "readiness_completion_consistent" CHECK (("readiness_check"."status" IN ('pending', 'running') AND "readiness_check"."completed_at" IS NULL) OR ("readiness_check"."status" IN ('passed', 'failed', 'error', 'skipped') AND "readiness_check"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"responsibility" text NOT NULL,
	"status" "review_status" DEFAULT 'requested' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"requested_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "review_context_unique" UNIQUE("organization_id","proposal_id","revision_id","id"),
	CONSTRAINT "review_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "review_responsibility_present" CHECK (length(trim("review"."responsibility")) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"review_id" text NOT NULL,
	"user_id" text,
	"group_id" text,
	"assigned_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	CONSTRAINT "review_assignment_one_target" CHECK (("review_assignment"."user_id" IS NOT NULL) <> ("review_assignment"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "specification_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"change_summary" text,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revision_context_unique" UNIQUE("organization_id","proposal_id","id"),
	CONSTRAINT "revision_number_unique" UNIQUE("organization_id","proposal_id","number"),
	CONSTRAINT "revision_positive_number" CHECK ("specification_revision"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"thread_id" text,
	"author_id" text NOT NULL,
	"anchor" jsonb,
	"replacement" text NOT NULL,
	"rationale" text,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	"accepted_revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_resolution_consistent" CHECK (("suggestion"."status" = 'pending' AND "suggestion"."resolved_at" IS NULL AND "suggestion"."resolved_by_id" IS NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'rejected' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'accepted' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NOT NULL AND "suggestion"."accepted_revision_id" <> "suggestion"."revision_id"))
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"review_id" text,
	"author_id" text NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"anchor" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	CONSTRAINT "thread_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "thread_context_unique" UNIQUE("organization_id","proposal_id","revision_id","id"),
	CONSTRAINT "thread_resolution_consistent" CHECK (("thread"."status" = 'open' AND "thread"."resolved_at" IS NULL AND "thread"."resolved_by_id" IS NULL) OR ("thread"."status" = 'resolved' AND "thread"."resolved_at" IS NOT NULL AND "thread"."resolved_by_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "account_user_id_idx";--> statement-breakpoint
DROP INDEX "session_user_id_idx";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_ended_by_id_user_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_proposal_id_revision_id_review_id_review_organization_id_proposal_id_revision_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id","review_id") REFERENCES "public"."review"("organization_id","proposal_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_product_id_product_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_product_id_proposal_id_proposal_organization_id_product_id_id_fk" FOREIGN KEY ("organization_id","product_id","proposal_id") REFERENCES "public"."proposal"("organization_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_proposal_id_revision_id_source_thread_id_thread_organization_id_proposal_id_revision_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id","source_thread_id") REFERENCES "public"."thread"("organization_id","proposal_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_external_link" ADD CONSTRAINT "delivery_external_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_external_link" ADD CONSTRAINT "delivery_external_link_organization_id_delivery_item_id_delivery_item_organization_id_id_fk" FOREIGN KEY ("organization_id","delivery_item_id") REFERENCES "public"."delivery_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item" ADD CONSTRAINT "delivery_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item" ADD CONSTRAINT "delivery_item_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item" ADD CONSTRAINT "delivery_item_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_item" ADD CONSTRAINT "delivery_item_parent_context_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id","parent_id") REFERENCES "public"."delivery_item"("organization_id","proposal_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "functional_group" ADD CONSTRAINT "functional_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_organization_id_group_id_functional_group_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."functional_group"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_organization_id_product_id_product_organization_id_id_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."product"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_evaluated_by_id_user_id_fk" FOREIGN KEY ("evaluated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_review_id_review_organization_id_id_fk" FOREIGN KEY ("organization_id","review_id") REFERENCES "public"."review"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_group_id_functional_group_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."functional_group"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_organization_id_proposal_id_proposal_organization_id_id_fk" FOREIGN KEY ("organization_id","proposal_id") REFERENCES "public"."proposal"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_proposal_id_revision_id_thread_id_thread_organization_id_proposal_id_revision_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id","thread_id") REFERENCES "public"."thread"("organization_id","proposal_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_proposal_id_accepted_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","accepted_revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_proposal_id_revision_id_specification_revision_organization_id_proposal_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","proposal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_proposal_id_revision_id_review_id_review_organization_id_proposal_id_revision_id_id_fk" FOREIGN KEY ("organization_id","proposal_id","revision_id","review_id") REFERENCES "public"."review"("organization_id","proposal_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_organization_id_thread_id_thread_organization_id_id_fk" FOREIGN KEY ("organization_id","thread_id") REFERENCES "public"."thread"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_active_reviewer_unique" ON "approval" USING btree ("review_id","reviewer_id") WHERE "approval"."status" = 'granted';--> statement-breakpoint
CREATE INDEX "approval_revision_status_idx" ON "approval" USING btree ("organization_id","proposal_id","revision_id","status");--> statement-breakpoint
CREATE INDEX "approval_reviewer_idx" ON "approval" USING btree ("organization_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "decision_product_idx" ON "decision" USING btree ("organization_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_proposal_idx" ON "decision" USING btree ("organization_id","proposal_id");--> statement-breakpoint
CREATE INDEX "delivery_external_sync_idx" ON "delivery_external_link" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "delivery_item_hierarchy_idx" ON "delivery_item" USING btree ("organization_id","proposal_id","revision_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "group_member_org_user_idx" ON "group_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "proposal_product_status_idx" ON "proposal" USING btree ("organization_id","product_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "proposal_creator_idx" ON "proposal" USING btree ("organization_id","created_by_id");--> statement-breakpoint
CREATE INDEX "readiness_check_revision_key_idx" ON "readiness_check" USING btree ("organization_id","proposal_id","revision_id","key","created_at");--> statement-breakpoint
CREATE INDEX "review_revision_idx" ON "review" USING btree ("organization_id","proposal_id","revision_id");--> statement-breakpoint
CREATE INDEX "review_status_idx" ON "review" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_user_unique" ON "review_assignment" USING btree ("review_id","user_id") WHERE "review_assignment"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_group_unique" ON "review_assignment" USING btree ("review_id","group_id") WHERE "review_assignment"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_assignment_user_idx" ON "review_assignment" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "review_assignment_group_idx" ON "review_assignment" USING btree ("organization_id","group_id");--> statement-breakpoint
CREATE INDEX "review_assignment_review_idx" ON "review_assignment" USING btree ("organization_id","review_id");--> statement-breakpoint
CREATE INDEX "suggestion_revision_status_idx" ON "suggestion" USING btree ("organization_id","proposal_id","revision_id","status");--> statement-breakpoint
CREATE INDEX "thread_proposal_status_idx" ON "thread" USING btree ("organization_id","proposal_id","status","blocking");--> statement-breakpoint
CREATE INDEX "thread_revision_review_idx" ON "thread" USING btree ("organization_id","proposal_id","revision_id","review_id");--> statement-breakpoint
CREATE INDEX "thread_message_chronology_idx" ON "thread_message" USING btree ("organization_id","thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");