CREATE TYPE "public"."code_checks_state" AS ENUM('pending', 'success', 'failure', 'none');--> statement-breakpoint
CREATE TYPE "public"."code_connection_status" AS ENUM('active', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."code_host_auth_kind" AS ENUM('github_app', 'token', 'oauth_consumer');--> statement-breakpoint
CREATE TYPE "public"."code_host_provider" AS ENUM('github', 'gitlab', 'bitbucket');--> statement-breakpoint
CREATE TYPE "public"."code_issue_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."code_link_source" AS ENUM('key', 'manual', 'agent_session', 'import', 'lictory');--> statement-breakpoint
CREATE TYPE "public"."code_link_target" AS ENUM('branch', 'pull_request', 'issue', 'commit');--> statement-breakpoint
CREATE TYPE "public"."code_pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."code_repository_visibility" AS ENUM('public', 'private', 'internal');--> statement-breakpoint
CREATE TYPE "public"."code_review_decision" AS ENUM('approved', 'changes_requested', 'review_required', 'none');--> statement-breakpoint
CREATE TYPE "public"."code_webhook_status" AS ENUM('pending', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."code_write_kind" AS ENUM('create_branch', 'open_pull_request', 'comment', 'request_review', 'merge', 'close', 'reopen');--> statement-breakpoint
CREATE TYPE "public"."code_write_status" AS ENUM('queued', 'sending', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "code_branch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"name" text NOT NULL,
	"head_sha" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_branch_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_branch_name_unique" UNIQUE("organization_id","repository_id","name")
);
--> statement-breakpoint
CREATE TABLE "code_commit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author_name" text,
	"author_login" text,
	"branch" text,
	"web_url" text NOT NULL,
	"committed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_commit_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_commit_sha_unique" UNIQUE("organization_id","repository_id","sha")
);
--> statement-breakpoint
CREATE TABLE "code_commit_checks" (
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"sha" text NOT NULL,
	"state" "code_checks_state" NOT NULL,
	"runs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_commit_checks_organization_id_repository_id_sha_pk" PRIMARY KEY("organization_id","repository_id","sha")
);
--> statement-breakpoint
CREATE TABLE "code_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" "code_host_provider" NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_kind" "code_host_auth_kind" NOT NULL,
	"account_label" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"encrypted_webhook_secret" text NOT NULL,
	"status" "code_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_verified_at" timestamp NOT NULL,
	"last_webhook_at" timestamp,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "code_connection_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_connection_name_present" CHECK (length(trim("code_connection"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "code_entity" (
	"key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text,
	"project_id" text,
	"work_item_id" text,
	"type" text NOT NULL,
	"facet" text,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_host_identity" (
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"login" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_host_identity_organization_id_connection_id_user_id_pk" PRIMARY KEY("organization_id","connection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "code_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"external_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_excerpt" text DEFAULT '' NOT NULL,
	"state" "code_issue_state" NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_login" text,
	"web_url" text NOT NULL,
	"host_created_at" timestamp NOT NULL,
	"host_updated_at" timestamp NOT NULL,
	"imported_work_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_issue_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_issue_number_unique" UNIQUE("organization_id","repository_id","number")
);
--> statement-breakpoint
CREATE TABLE "code_pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"external_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body_excerpt" text DEFAULT '' NOT NULL,
	"state" "code_pull_request_state" NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"author_login" text,
	"author_is_bot" boolean DEFAULT false NOT NULL,
	"head_branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_branch" text NOT NULL,
	"review_decision" "code_review_decision" DEFAULT 'none' NOT NULL,
	"requested_reviewers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mergeable" boolean,
	"web_url" text NOT NULL,
	"merged_at" timestamp,
	"merged_by_login" text,
	"closed_at" timestamp,
	"host_created_at" timestamp NOT NULL,
	"host_updated_at" timestamp NOT NULL,
	"opened_by_id" text,
	"opened_via" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_pull_request_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_pull_request_number_unique" UNIQUE("organization_id","repository_id","number")
);
--> statement-breakpoint
CREATE TABLE "code_repository" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"web_url" text NOT NULL,
	"clone_url" text NOT NULL,
	"visibility" "code_repository_visibility" NOT NULL,
	"host_archived" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"sync_due_at" timestamp,
	"sync_lease_until" timestamp,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_repository_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_repository_external_unique" UNIQUE("organization_id","connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "code_repository_project" (
	"organization_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"project_id" text NOT NULL,
	"linked_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "code_repository_project_organization_id_repository_id_project_id_pk" PRIMARY KEY("organization_id","repository_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "code_webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "code_webhook_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp,
	"last_error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "code_webhook_delivery_unique" UNIQUE("connection_id","delivery_id")
);
--> statement-breakpoint
CREATE TABLE "code_work_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"project_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"target" "code_link_target" NOT NULL,
	"target_id" text NOT NULL,
	"source" "code_link_source" NOT NULL,
	"created_by_id" text NOT NULL,
	"performed_via" text,
	"agent_session_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"unlinked_at" timestamp,
	"unlinked_by_id" text,
	CONSTRAINT "code_work_link_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "code_write" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"kind" "code_write_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"work_item_id" text,
	"pull_request_id" text,
	"requested_by_id" text NOT NULL,
	"performed_via" text,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "code_write_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "code_write_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "code_write_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "code_branch" ADD CONSTRAINT "code_branch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_branch" ADD CONSTRAINT "code_branch_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_commit" ADD CONSTRAINT "code_commit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_commit" ADD CONSTRAINT "code_commit_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_commit_checks" ADD CONSTRAINT "code_commit_checks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_commit_checks" ADD CONSTRAINT "code_commit_checks_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_connection" ADD CONSTRAINT "code_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_connection" ADD CONSTRAINT "code_connection_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_entity" ADD CONSTRAINT "code_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_host_identity" ADD CONSTRAINT "code_host_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_host_identity" ADD CONSTRAINT "code_host_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_host_identity" ADD CONSTRAINT "code_host_identity_organization_id_connection_id_code_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."code_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_issue" ADD CONSTRAINT "code_issue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_issue" ADD CONSTRAINT "code_issue_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_issue" ADD CONSTRAINT "code_issue_organization_id_imported_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","imported_work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD CONSTRAINT "code_pull_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD CONSTRAINT "code_pull_request_opened_by_id_user_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_pull_request" ADD CONSTRAINT "code_pull_request_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository" ADD CONSTRAINT "code_repository_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository" ADD CONSTRAINT "code_repository_organization_id_connection_id_code_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."code_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository_project" ADD CONSTRAINT "code_repository_project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository_project" ADD CONSTRAINT "code_repository_project_linked_by_id_user_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository_project" ADD CONSTRAINT "code_repository_project_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_repository_project" ADD CONSTRAINT "code_repository_project_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_webhook_delivery" ADD CONSTRAINT "code_webhook_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_webhook_delivery" ADD CONSTRAINT "code_webhook_delivery_organization_id_connection_id_code_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."code_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_work_link" ADD CONSTRAINT "code_work_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_work_link" ADD CONSTRAINT "code_work_link_unlinked_by_id_user_id_fk" FOREIGN KEY ("unlinked_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_work_link" ADD CONSTRAINT "code_work_link_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_work_link" ADD CONSTRAINT "code_work_link_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_write" ADD CONSTRAINT "code_write_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_write" ADD CONSTRAINT "code_write_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_write" ADD CONSTRAINT "code_write_organization_id_connection_id_code_connection_organization_id_id_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."code_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_write" ADD CONSTRAINT "code_write_organization_id_repository_id_code_repository_organization_id_id_fk" FOREIGN KEY ("organization_id","repository_id") REFERENCES "public"."code_repository"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "code_connection_org_idx" ON "code_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "code_entity_scope_idx" ON "code_entity" USING btree ("organization_id","type","facet");--> statement-breakpoint
CREATE INDEX "code_entity_item_idx" ON "code_entity" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "code_pull_request_head_idx" ON "code_pull_request" USING btree ("organization_id","repository_id","head_sha");--> statement-breakpoint
CREATE INDEX "code_repository_sync_idx" ON "code_repository" USING btree ("sync_due_at");--> statement-breakpoint
CREATE INDEX "code_repository_project_project_idx" ON "code_repository_project" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "code_webhook_delivery_pending_idx" ON "code_webhook_delivery" USING btree ("status","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "code_work_link_active_unique" ON "code_work_link" USING btree ("organization_id","work_item_id","target","target_id") WHERE "code_work_link"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "code_work_link_item_idx" ON "code_work_link" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE INDEX "code_work_link_target_idx" ON "code_work_link" USING btree ("organization_id","target","target_id");--> statement-breakpoint
CREATE INDEX "code_write_due_idx" ON "code_write" USING btree ("status","next_attempt_at");