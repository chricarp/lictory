CREATE TYPE "public"."autonomy_level" AS ENUM('assist', 'build', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."claim_state" AS ENUM('starting', 'active', 'waiting', 'released', 'completed');--> statement-breakpoint
CREATE TABLE "autonomy_policy" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"level" "autonomy_level" NOT NULL,
	"implementer_agent_ids" jsonb NOT NULL,
	"reviewer_agent_id" text,
	"max_concurrent_sessions" integer NOT NULL,
	"autopilot_requires" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_policy_organization_id_project_id_pk" PRIMARY KEY("organization_id","project_id"),
	CONSTRAINT "autonomy_policy_concurrency" CHECK ("autonomy_policy"."max_concurrent_sessions" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "autopilot_merge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"claim_id" text,
	"pull_request_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"policy_version" integer NOT NULL,
	"authorized_by_id" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_merge_outcome" CHECK ("autopilot_merge"."outcome" in ('requested', 'refused'))
);
--> statement-breakpoint
CREATE TABLE "claim_question" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" text
);
--> statement-breakpoint
CREATE TABLE "definition_of_done" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"checks" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_of_done_organization_id_project_id_pk" PRIMARY KEY("organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "dispatch_backoff" (
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"failures" integer NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_backoff_organization_id_work_item_id_pk" PRIMARY KEY("organization_id","work_item_id")
);
--> statement-breakpoint
CREATE TABLE "done_sign_off" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"check_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_id" text,
	CONSTRAINT "done_sign_off_kind" CHECK ("done_sign_off"."kind" in ('sign_off', 'override')),
	CONSTRAINT "done_sign_off_override_reason" CHECK ("done_sign_off"."kind" <> 'override' OR length(trim(coalesce("done_sign_off"."reason", ''))) > 0),
	CONSTRAINT "done_sign_off_withdrawal_consistent" CHECK (("done_sign_off"."withdrawn_at" IS NULL) = ("done_sign_off"."withdrawn_by_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "work_item_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"agent_session_id" text,
	"owner_id" text NOT NULL,
	"source" text NOT NULL,
	"state" "claim_state" NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"from_status_id" text,
	"started_status_id" text,
	"last_progress" text,
	"last_progress_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by_id" text,
	"end_reason" text,
	"end_note" text,
	"delivered_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_claim_source" CHECK ("work_item_claim"."source" in ('agent', 'dispatcher')),
	CONSTRAINT "work_item_claim_end_consistent" CHECK (("work_item_claim"."state" in ('released', 'completed')) = ("work_item_claim"."ended_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "autonomy_policy" ADD CONSTRAINT "autonomy_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_policy" ADD CONSTRAINT "autonomy_policy_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_policy" ADD CONSTRAINT "autonomy_policy_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_merge" ADD CONSTRAINT "autopilot_merge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_merge" ADD CONSTRAINT "autopilot_merge_claim_id_work_item_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."work_item_claim"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopilot_merge" ADD CONSTRAINT "autopilot_merge_authorized_by_id_user_id_fk" FOREIGN KEY ("authorized_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_question" ADD CONSTRAINT "claim_question_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_question" ADD CONSTRAINT "claim_question_claim_id_work_item_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."work_item_claim"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_question" ADD CONSTRAINT "claim_question_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_of_done" ADD CONSTRAINT "definition_of_done_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_of_done" ADD CONSTRAINT "definition_of_done_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_of_done" ADD CONSTRAINT "definition_of_done_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_backoff" ADD CONSTRAINT "dispatch_backoff_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "done_sign_off" ADD CONSTRAINT "done_sign_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "done_sign_off" ADD CONSTRAINT "done_sign_off_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "done_sign_off" ADD CONSTRAINT "done_sign_off_withdrawn_by_id_user_id_fk" FOREIGN KEY ("withdrawn_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "done_sign_off" ADD CONSTRAINT "done_sign_off_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_claim" ADD CONSTRAINT "work_item_claim_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_claim" ADD CONSTRAINT "work_item_claim_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_claim" ADD CONSTRAINT "work_item_claim_ended_by_id_user_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_claim" ADD CONSTRAINT "work_item_claim_organization_id_project_id_work_item_id_work_item_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","work_item_id") REFERENCES "public"."work_item"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autopilot_merge_head_unique" ON "autopilot_merge" USING btree ("organization_id","pull_request_id","head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_question_thread_unique" ON "claim_question" USING btree ("organization_id","thread_id");--> statement-breakpoint
CREATE INDEX "claim_question_claim_idx" ON "claim_question" USING btree ("organization_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "done_sign_off_active_unique" ON "done_sign_off" USING btree ("organization_id","work_item_id","revision_id","check_id") WHERE "done_sign_off"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "done_sign_off_item_idx" ON "done_sign_off" USING btree ("organization_id","work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_claim_live_unique" ON "work_item_claim" USING btree ("organization_id","work_item_id") WHERE "work_item_claim"."state" in ('starting', 'active', 'waiting');--> statement-breakpoint
CREATE INDEX "work_item_claim_project_idx" ON "work_item_claim" USING btree ("organization_id","project_id","state");--> statement-breakpoint
CREATE INDEX "work_item_claim_item_idx" ON "work_item_claim" USING btree ("organization_id","work_item_id","created_at");