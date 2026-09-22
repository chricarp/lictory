CREATE TYPE "public"."suggestion_decision_kind" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
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
ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_resolution_consistent";--> statement-breakpoint
ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_organization_id_work_item_id_revision_id_thread_id_thread_organization_id_work_item_id_revision_id_id_fk";
--> statement-breakpoint
ALTER TABLE "suggestion" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "suggestion" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."suggestion_status";--> statement-breakpoint
-- Existing suggestions keep their history under the pull-request vocabulary:
-- pending ones are open for review, accepted ones were merged, rejected closed.
UPDATE "suggestion" SET "status" = CASE "status" WHEN 'pending' THEN 'open' WHEN 'accepted' THEN 'merged' WHEN 'rejected' THEN 'closed' ELSE "status" END;--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('draft', 'open', 'merged', 'closed');--> statement-breakpoint
ALTER TABLE "suggestion" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."suggestion_status";--> statement-breakpoint
ALTER TABLE "suggestion" ALTER COLUMN "status" SET DATA TYPE "public"."suggestion_status" USING "status"::"public"."suggestion_status";--> statement-breakpoint
ALTER TABLE "suggestion" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestion" ADD COLUMN "opened_at" timestamp;--> statement-breakpoint
UPDATE "suggestion" SET "opened_at" = "created_at" WHERE "status" <> 'draft';--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "suggestion_id" text;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_context_unique" UNIQUE("organization_id","work_item_id","id");--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_decision" ADD CONSTRAINT "suggestion_decision_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_assigned_by_id_user_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_reviewer" ADD CONSTRAINT "suggestion_reviewer_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_decision_active_unique" ON "suggestion_decision" USING btree ("suggestion_id","reviewer_id") WHERE "suggestion_decision"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "suggestion_decision_suggestion_idx" ON "suggestion_decision" USING btree ("organization_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_reviewer_active_unique" ON "suggestion_reviewer" USING btree ("suggestion_id","user_id") WHERE "suggestion_reviewer"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "suggestion_reviewer_user_idx" ON "suggestion_reviewer" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "suggestion_reviewer_suggestion_idx" ON "suggestion_reviewer" USING btree ("organization_id","suggestion_id");--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_organization_id_work_item_id_suggestion_id_suggestion_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","suggestion_id") REFERENCES "public"."suggestion"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_positive_version" CHECK ("suggestion"."version" > 0);--> statement-breakpoint
ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_resolution_consistent" CHECK (("suggestion"."status" IN ('draft', 'open') AND "suggestion"."resolved_at" IS NULL AND "suggestion"."resolved_by_id" IS NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'closed' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NULL) OR ("suggestion"."status" = 'merged' AND "suggestion"."resolved_at" IS NOT NULL AND "suggestion"."resolved_by_id" IS NOT NULL AND "suggestion"."accepted_revision_id" IS NOT NULL AND "suggestion"."accepted_revision_id" <> "suggestion"."revision_id"));