CREATE TYPE "public"."approval_status" AS ENUM('granted', 'revoked', 'stale');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('pending', 'running', 'passed', 'failed', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."delivery_connection_status" AS ENUM('active', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."delivery_mode" AS ENUM('native', 'external');--> statement-breakpoint
CREATE TYPE "public"."delivery_provider_kind" AS ENUM('jira_cloud');--> statement-breakpoint
CREATE TYPE "public"."delivery_publication_status" AS ENUM('running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_sync_status" AS ENUM('pending', 'synced', 'failed', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."estimate_scale" AS ENUM('none', 'fibonacci', 'linear', 'tshirt');--> statement-breakpoint
CREATE TYPE "public"."iteration_event_kind" AS ENUM('added', 'removed', 'estimate_changed', 'completed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."iteration_mode" AS ENUM('off', 'manual', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."iteration_state" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."readiness_policy" AS ENUM('off', 'warn', 'block');--> statement-breakpoint
CREATE TYPE "public"."refinement_state" AS ENUM('draft', 'refinement', 'in_review', 'ready');--> statement-breakpoint
CREATE TYPE "public"."relation_kind" AS ENUM('blocks', 'relates', 'duplicates');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('requested', 'in_progress', 'changes_requested', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."status_category" AS ENUM('backlog', 'unstarted', 'started', 'done', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."suggestion_decision_kind" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('draft', 'open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."work_item_priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."notification_email_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notification_preference_scope" AS ENUM('organization', 'project', 'team');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"handle" text,
	"appearance" text DEFAULT 'system' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
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
	"project_id" text NOT NULL,
	"work_item_id" text,
	"revision_id" text,
	"source_thread_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "decision_source_context" CHECK (("decision"."revision_id" IS NULL OR "decision"."work_item_id" IS NOT NULL) AND ("decision"."source_thread_id" IS NULL OR "decision"."revision_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "delivery_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "delivery_provider_kind" NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"account_label" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"status" "delivery_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_verified_at" timestamp NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "delivery_connection_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "delivery_connection_name_present" CHECK (length(trim("delivery_connection"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_publication" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"root_item_id" text,
	"item_ids" jsonb NOT NULL,
	"overwrite_item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "delivery_publication_status" DEFAULT 'running' NOT NULL,
	"lease_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "delivery_target" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"team_id" text,
	"external_project_id" text NOT NULL,
	"external_project_key" text NOT NULL,
	"type_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_target_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"removed_at" timestamp,
	CONSTRAINT "file_object_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "file_object_size_positive" CHECK ("file_object"."size" > 0)
);
--> statement-breakpoint
CREATE TABLE "iteration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"goal" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"state" "iteration_state" DEFAULT 'planned' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"summary" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "iteration_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "iteration_team_id_unique" UNIQUE("organization_id","team_id","id"),
	CONSTRAINT "iteration_team_number_unique" UNIQUE("organization_id","team_id","number"),
	CONSTRAINT "iteration_dates" CHECK ("iteration"."ends_at" > "iteration"."starts_at"),
	CONSTRAINT "iteration_state_consistent" CHECK (("iteration"."state" = 'planned' AND "iteration"."started_at" IS NULL AND "iteration"."completed_at" IS NULL) OR ("iteration"."state" = 'active' AND "iteration"."started_at" IS NOT NULL AND "iteration"."completed_at" IS NULL) OR ("iteration"."state" = 'completed' AND "iteration"."started_at" IS NOT NULL AND "iteration"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "iteration_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"iteration_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"kind" "iteration_event_kind" NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "label_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "label_project_name_unique" UNIQUE("organization_id","project_id","name")
);
--> statement-breakpoint
CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"target_date" timestamp,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "milestone_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "milestone_project_name_unique" UNIQUE("organization_id","project_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_onboarding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"decided_by_id" text NOT NULL,
	"decisions" jsonb NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
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
	CONSTRAINT "role_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "role_name_present" CHECK (length(trim("organization_role"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "organization_role_member" (
	"organization_id" text NOT NULL,
	"role_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_role_member_role_id_user_id_pk" PRIMARY KEY("role_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"default_team_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "project_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "project_org_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "project_org_key_unique" UNIQUE("organization_id","key"),
	CONSTRAINT "project_key_format" CHECK ("project"."key" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
--> statement-breakpoint
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
CREATE TABLE "readiness_check" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
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
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"responsibility" text NOT NULL,
	"status" "review_status" DEFAULT 'requested' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"requested_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "review_context_unique" UNIQUE("organization_id","work_item_id","revision_id","id"),
	CONSTRAINT "review_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "review_responsibility_present" CHECK (length(trim("review"."responsibility")) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"review_id" text NOT NULL,
	"user_id" text,
	"role_id" text,
	"assigned_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	CONSTRAINT "review_assignment_one_target" CHECK (("review_assignment"."user_id" IS NOT NULL) <> ("review_assignment"."role_id" IS NOT NULL))
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
CREATE TABLE "specification_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"change_summary" text,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "revision_context_unique" UNIQUE("organization_id","work_item_id","id"),
	CONSTRAINT "revision_number_unique" UNIQUE("organization_id","work_item_id","number"),
	CONSTRAINT "revision_positive_number" CHECK ("specification_revision"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"thread_id" text,
	"author_id" text NOT NULL,
	"anchor" jsonb,
	"replacement" text NOT NULL,
	"title" text,
	"rationale" text,
	"status" "suggestion_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"opened_at" timestamp,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	"accepted_revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "suggestion_context_unique" UNIQUE("organization_id","work_item_id","id"),
	CONSTRAINT "suggestion_positive_version" CHECK ("suggestion"."version" > 0),
	CONSTRAINT "suggestion_resolution_consistent" CHECK (("suggestion"."status" IN ('draft', 'open') AND "suggestion"."resolved_at" IS NULL AND "suggestion"."resolved_by_id" IS NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'closed' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'merged' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NOT NULL AND "suggestion"."accepted_revision_id" <> "suggestion"."revision_id"))
);
--> statement-breakpoint
CREATE TABLE "suggestion_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"version" integer NOT NULL,
	"decision" "suggestion_decision_kind" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"superseded_at" timestamp,
	"superseded_reason" text,
	CONSTRAINT "suggestion_decision_supersede_consistent" CHECK (("suggestion_decision"."superseded_at" IS NULL AND "suggestion_decision"."superseded_reason" IS NULL) OR ("suggestion_decision"."superseded_at" IS NOT NULL AND "suggestion_decision"."superseded_reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "suggestion_reviewer" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"delivery_mode" "delivery_mode" DEFAULT 'native' NOT NULL,
	"readiness_policy" "readiness_policy" DEFAULT 'warn' NOT NULL,
	"estimate_scale" "estimate_scale" DEFAULT 'fibonacci' NOT NULL,
	"iteration_mode" "iteration_mode" DEFAULT 'manual' NOT NULL,
	"iteration_weeks" integer DEFAULT 2 NOT NULL,
	"iteration_start_day" integer DEFAULT 1 NOT NULL,
	"upcoming_iterations" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "team_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "team_name_present" CHECK (length(trim("team"."name")) > 0),
	CONSTRAINT "team_iteration_weeks" CHECK ("team"."iteration_weeks" BETWEEN 1 AND 8),
	CONSTRAINT "team_start_day" CHECK ("team"."iteration_start_day" BETWEEN 0 AND 6),
	CONSTRAINT "team_upcoming" CHECK ("team"."upcoming_iterations" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_work_item_type" (
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"type_id" text NOT NULL,
	CONSTRAINT "team_work_item_type_team_id_type_id_pk" PRIMARY KEY("team_id","type_id")
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"review_id" text,
	"suggestion_id" text,
	"pull_request_id" text,
	"commit_id" text,
	"author_id" text NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"anchor" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	CONSTRAINT "thread_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "thread_context_unique" UNIQUE("organization_id","work_item_id","revision_id","id"),
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
CREATE TABLE "work_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"type_id" text NOT NULL,
	"parent_id" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"problem_statement" text,
	"status_id" text NOT NULL,
	"refinement_state" "refinement_state",
	"main_protected" boolean DEFAULT false NOT NULL,
	"priority" "work_item_priority" DEFAULT 'none' NOT NULL,
	"assignee_id" text,
	"milestone_id" text,
	"iteration_id" text,
	"estimate" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"rank" text NOT NULL,
	"source_revision_id" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "proposal_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_item_project_id_unique" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "work_item_project_number_unique" UNIQUE("organization_id","project_id","number"),
	CONSTRAINT "work_item_not_own_parent" CHECK ("work_item"."parent_id" IS NULL OR "work_item"."parent_id" <> "work_item"."id"),
	CONSTRAINT "work_item_positive_number" CHECK ("work_item"."number" > 0),
	CONSTRAINT "work_item_estimate_range" CHECK ("work_item"."estimate" IS NULL OR "work_item"."estimate" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "work_item_external_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text,
	"external_key" text,
	"external_url" text,
	"external_status" text,
	"status" "delivery_sync_status" DEFAULT 'pending' NOT NULL,
	"published_revision_id" text,
	"payload_hash" text,
	"external_updated_at" timestamp,
	"create_attempted_at" timestamp,
	"last_error" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_link_destination_unique" UNIQUE("organization_id","work_item_id","connection_id"),
	CONSTRAINT "external_link_identity_unique" UNIQUE("organization_id","connection_id","external_id"),
	CONSTRAINT "external_link_synced_identity" CHECK ("work_item_external_link"."status" <> 'synced' OR ("work_item_external_link"."external_id" IS NOT NULL AND "work_item_external_link"."synced_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "work_item_label" (
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"label_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_label_work_item_id_label_id_pk" PRIMARY KEY("work_item_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" "relation_kind" NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_relation_unique" UNIQUE("organization_id","from_id","to_id","kind"),
	CONSTRAINT "work_item_relation_not_self" CHECK ("work_item_relation"."from_id" <> "work_item_relation"."to_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"level" integer NOT NULL,
	"has_specification" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "work_item_type_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_item_type_level" CHECK ("work_item_type"."level" BETWEEN 0 AND 3),
	CONSTRAINT "work_item_type_name_present" CHECK (length(trim("work_item_type"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_status" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"category" "status_category" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "workflow_status_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "workflow_status_team_id_unique" UNIQUE("organization_id","team_id","id"),
	CONSTRAINT "workflow_status_name_present" CHECK (length(trim("workflow_status"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_change" (
	"organization_id" text NOT NULL,
	"cursor" bigint NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text,
	"change" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_change_organization_id_cursor_pk" PRIMARY KEY("organization_id","cursor")
);
--> statement-breakpoint
CREATE TABLE "sync_clock" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mutation" (
	"organization_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"cursor" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_mutation_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"project_id" text,
	"team_id" text,
	"work_item_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_email" (
	"notification_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "notification_email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"last_error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"scope" "notification_preference_scope" NOT NULL,
	"scope_id" text NOT NULL,
	"kind" text NOT NULL,
	"in_app" boolean NOT NULL,
	"email" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_pk" PRIMARY KEY("user_id","organization_id","scope","scope_id","kind")
);
--> statement-breakpoint
CREATE TABLE "work_item_watcher" (
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"watching" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_watcher_organization_id_work_item_id_user_id_pk" PRIMARY KEY("organization_id","work_item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_ended_by_id_user_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_work_item_id_revision_id_review_id_review_organization_id_work_item_id_revision_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id","review_id") REFERENCES "public"."review"("organization_id","work_item_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_project_id_work_item_id_work_item_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","work_item_id") REFERENCES "public"."work_item"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_organization_id_work_item_id_revision_id_source_thread_id_thread_organization_id_work_item_id_revision_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id","source_thread_id") REFERENCES "public"."thread"("organization_id","work_item_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD CONSTRAINT "delivery_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD CONSTRAINT "delivery_connection_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_publication" ADD CONSTRAINT "delivery_publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_publication" ADD CONSTRAINT "delivery_publication_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_publication" ADD CONSTRAINT "delivery_publication_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_publication" ADD CONSTRAINT "delivery_publication_organization_id_connection_id_delivery_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."delivery_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_organization_id_connection_id_delivery_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."delivery_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_project_id_work_item_id_work_item_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","work_item_id") REFERENCES "public"."work_item"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_event" ADD CONSTRAINT "iteration_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_event" ADD CONSTRAINT "iteration_event_organization_id_iteration_id_iteration_organization_id_id_fk" FOREIGN KEY ("organization_id","iteration_id") REFERENCES "public"."iteration"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration_event" ADD CONSTRAINT "iteration_event_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "onboarding_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "onboarding_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "organization_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_member" ADD CONSTRAINT "organization_role_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_member" ADD CONSTRAINT "organization_role_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_role_member" ADD CONSTRAINT "organization_role_member_organization_id_role_id_organization_role_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."organization_role"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_default_team_fk" FOREIGN KEY ("organization_id","default_team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_work_item_id_pull_request_id_specification_pull_request_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","pull_request_id") REFERENCES "public"."specification_pull_request"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_role_id_organization_role_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."organization_role"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_evaluated_by_id_user_id_fk" FOREIGN KEY ("evaluated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_check" ADD CONSTRAINT "readiness_check_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_review_id_review_organization_id_id_fk" FOREIGN KEY ("organization_id","review_id") REFERENCES "public"."review"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_role_id_organization_role_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."organization_role"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revision" ADD CONSTRAINT "specification_revision_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_organization_id_work_item_id_accepted_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","accepted_revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_work_item_type" ADD CONSTRAINT "team_work_item_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_work_item_type" ADD CONSTRAINT "team_work_item_type_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_work_item_type" ADD CONSTRAINT "team_work_item_type_organization_id_type_id_work_item_type_organization_id_id_fk" FOREIGN KEY ("organization_id","type_id") REFERENCES "public"."work_item_type"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_revision_id_review_id_review_organization_id_work_item_id_revision_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id","review_id") REFERENCES "public"."review"("organization_id","work_item_id","revision_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_pull_request_id_specification_pull_request_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","pull_request_id") REFERENCES "public"."specification_pull_request"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_commit_id_specification_commit_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","commit_id") REFERENCES "public"."specification_commit"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_organization_id_thread_id_thread_organization_id_id_fk" FOREIGN KEY ("organization_id","thread_id") REFERENCES "public"."thread"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_type_fk" FOREIGN KEY ("organization_id","type_id") REFERENCES "public"."work_item_type"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_status_fk" FOREIGN KEY ("organization_id","team_id","status_id") REFERENCES "public"."workflow_status"("organization_id","team_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_iteration_fk" FOREIGN KEY ("organization_id","team_id","iteration_id") REFERENCES "public"."iteration"("organization_id","team_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_parent_fk" FOREIGN KEY ("organization_id","project_id","parent_id") REFERENCES "public"."work_item"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_milestone_fk" FOREIGN KEY ("organization_id","milestone_id") REFERENCES "public"."milestone"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD CONSTRAINT "work_item_external_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD CONSTRAINT "work_item_external_link_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD CONSTRAINT "work_item_external_link_organization_id_connection_id_delivery_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."delivery_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_external_link" ADD CONSTRAINT "work_item_external_link_organization_id_work_item_id_published_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","published_revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_organization_id_label_id_label_organization_id_id_fk" FOREIGN KEY ("organization_id","label_id") REFERENCES "public"."label"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_organization_id_from_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","from_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relation" ADD CONSTRAINT "work_item_relation_organization_id_to_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","to_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_status" ADD CONSTRAINT "workflow_status_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_status" ADD CONSTRAINT "workflow_status_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_change" ADD CONSTRAINT "sync_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_clock" ADD CONSTRAINT "sync_clock_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutation" ADD CONSTRAINT "sync_mutation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email" ADD CONSTRAINT "notification_email_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email" ADD CONSTRAINT "notification_email_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_email" ADD CONSTRAINT "notification_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_watcher" ADD CONSTRAINT "work_item_watcher_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_watcher" ADD CONSTRAINT "work_item_watcher_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_active_reviewer_unique" ON "approval" USING btree ("review_id","reviewer_id") WHERE "approval"."status" = 'granted';--> statement-breakpoint
CREATE INDEX "approval_revision_status_idx" ON "approval" USING btree ("organization_id","work_item_id","revision_id","status");--> statement-breakpoint
CREATE INDEX "approval_reviewer_idx" ON "approval" USING btree ("organization_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "decision_project_idx" ON "decision" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_item_idx" ON "decision" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_connection_active_site_unique" ON "delivery_connection" USING btree ("organization_id","provider","base_url") WHERE "delivery_connection"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "delivery_publication_running_idx" ON "delivery_publication" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "delivery_publication_project_idx" ON "delivery_publication" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_target_org_default_unique" ON "delivery_target" USING btree ("organization_id") WHERE "delivery_target"."team_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_target_team_unique" ON "delivery_target" USING btree ("organization_id","team_id") WHERE "delivery_target"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "file_object_item_idx" ON "file_object" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iteration_one_active_per_team" ON "iteration" USING btree ("organization_id","team_id") WHERE "iteration"."state" = 'active';--> statement-breakpoint
CREATE INDEX "iteration_event_iteration_idx" ON "iteration_event" USING btree ("organization_id","iteration_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_active_name_unique" ON "organization_role" USING btree ("organization_id",lower("name")) WHERE "organization_role"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "role_member_org_user_idx" ON "organization_role_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "readiness_check_revision_key_idx" ON "readiness_check" USING btree ("organization_id","work_item_id","revision_id","key","created_at");--> statement-breakpoint
CREATE INDEX "review_revision_idx" ON "review" USING btree ("organization_id","work_item_id","revision_id");--> statement-breakpoint
CREATE INDEX "review_status_idx" ON "review" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_user_unique" ON "review_assignment" USING btree ("review_id","user_id") WHERE "review_assignment"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_role_unique" ON "review_assignment" USING btree ("review_id","role_id") WHERE "review_assignment"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_assignment_user_idx" ON "review_assignment" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "review_assignment_role_idx" ON "review_assignment" USING btree ("organization_id","role_id");--> statement-breakpoint
CREATE INDEX "review_assignment_review_idx" ON "review_assignment" USING btree ("organization_id","review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_active_name_unique" ON "specification_branch" USING btree ("organization_id","work_item_id","name") WHERE "specification_branch"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "commit_revision_unique" ON "specification_commit" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "suggestion_revision_status_idx" ON "suggestion" USING btree ("organization_id","work_item_id","revision_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_decision_active_unique" ON "suggestion_decision" USING btree ("suggestion_id","reviewer_id") WHERE "suggestion_decision"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "suggestion_decision_suggestion_idx" ON "suggestion_decision" USING btree ("organization_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_reviewer_active_unique" ON "suggestion_reviewer" USING btree ("suggestion_id","user_id") WHERE "suggestion_reviewer"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "suggestion_reviewer_user_idx" ON "suggestion_reviewer" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "suggestion_reviewer_suggestion_idx" ON "suggestion_reviewer" USING btree ("organization_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_org_active_name_unique" ON "team" USING btree ("organization_id",lower("name")) WHERE "team"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "team_member_org_user_idx" ON "team_member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "thread_item_status_idx" ON "thread" USING btree ("organization_id","work_item_id","status","blocking");--> statement-breakpoint
CREATE INDEX "thread_revision_review_idx" ON "thread" USING btree ("organization_id","work_item_id","revision_id","review_id");--> statement-breakpoint
CREATE INDEX "thread_message_chronology_idx" ON "thread_message" USING btree ("organization_id","thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "work_item_project_idx" ON "work_item" USING btree ("organization_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "work_item_team_rank_idx" ON "work_item" USING btree ("organization_id","team_id","rank");--> statement-breakpoint
CREATE INDEX "work_item_iteration_idx" ON "work_item" USING btree ("organization_id","iteration_id");--> statement-breakpoint
CREATE INDEX "work_item_creator_idx" ON "work_item" USING btree ("organization_id","created_by_id");--> statement-breakpoint
CREATE INDEX "work_item_parent_idx" ON "work_item" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "work_item_assignee_idx" ON "work_item" USING btree ("organization_id","assignee_id");--> statement-breakpoint
CREATE INDEX "work_item_milestone_idx" ON "work_item" USING btree ("organization_id","milestone_id");--> statement-breakpoint
CREATE INDEX "external_link_sync_idx" ON "work_item_external_link" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "work_item_label_label_idx" ON "work_item_label" USING btree ("organization_id","label_id");--> statement-breakpoint
CREATE INDEX "work_item_relation_to_idx" ON "work_item_relation" USING btree ("organization_id","to_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_type_org_active_name_unique" ON "work_item_type" USING btree ("organization_id",lower("name")) WHERE "work_item_type"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_status_team_active_name_unique" ON "workflow_status" USING btree ("organization_id","team_id",lower("name")) WHERE "workflow_status"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "activity_item_idx" ON "activity" USING btree ("organization_id","work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_scope_cursor_idx" ON "sync_change" USING btree ("organization_id","project_id","cursor");--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notification" USING btree ("user_id","organization_id") WHERE "notification"."read_at" is null and "notification"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_idx" ON "notification" USING btree ("user_id","dedupe_key") WHERE "notification"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notification_email_pending_idx" ON "notification_email" USING btree ("next_attempt_at") WHERE "notification_email"."status" = 'pending';