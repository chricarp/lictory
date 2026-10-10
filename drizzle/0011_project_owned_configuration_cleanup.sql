ALTER TABLE "iteration" DROP CONSTRAINT "iteration_team_id_unique";--> statement-breakpoint
ALTER TABLE "iteration" DROP CONSTRAINT "iteration_team_number_unique";--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP CONSTRAINT "pr_review_role_unique";--> statement-breakpoint
ALTER TABLE "workflow_status" DROP CONSTRAINT "workflow_status_team_id_unique";--> statement-breakpoint
ALTER TABLE "review_assignment" DROP CONSTRAINT "review_assignment_one_target";--> statement-breakpoint
ALTER TABLE "team" DROP CONSTRAINT "team_iteration_weeks";--> statement-breakpoint
ALTER TABLE "team" DROP CONSTRAINT "team_start_day";--> statement-breakpoint
ALTER TABLE "team" DROP CONSTRAINT "team_upcoming";--> statement-breakpoint
ALTER TABLE "delivery_connection" DROP CONSTRAINT "delivery_connection_organization_id_team_id_team_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "delivery_target" DROP CONSTRAINT "delivery_target_organization_id_team_id_team_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "iteration" DROP CONSTRAINT "iteration_organization_id_team_id_team_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "organization_onboarding" DROP CONSTRAINT "onboarding_team_fk";--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_default_team_fk";--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP CONSTRAINT "pull_request_review_organization_id_role_id_organization_role_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "review_assignment" DROP CONSTRAINT "review_assignment_organization_id_role_id_organization_role_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_team_fk";--> statement-breakpoint
ALTER TABLE "workflow_status" DROP CONSTRAINT "workflow_status_organization_id_team_id_team_organization_id_id_fk";--> statement-breakpoint
DROP INDEX "delivery_connection_active_team_site_unique";--> statement-breakpoint
DROP INDEX "iteration_one_active_per_team";--> statement-breakpoint
DROP INDEX "review_assignment_active_role_unique";--> statement-breakpoint
DROP INDEX "review_assignment_role_idx";--> statement-breakpoint
DROP INDEX "team_org_active_name_unique";--> statement-breakpoint
DROP INDEX "work_item_team_rank_idx";--> statement-breakpoint
DROP INDEX "workflow_status_team_active_name_unique";--> statement-breakpoint
DROP INDEX "delivery_connection_active_site_unique";--> statement-breakpoint
ALTER TABLE "delivery_target" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "iteration" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review" ALTER COLUMN "discipline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "team" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_status" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_project_id_unique" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_project_number_unique" UNIQUE("organization_id","project_id","number");--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pr_review_discipline_unique" UNIQUE("pull_request_id","discipline_id");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_project_id_unique" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "workflow_status" ADD CONSTRAINT "workflow_status_project_id_unique" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "delivery_target" ADD CONSTRAINT "delivery_target_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iteration" ADD CONSTRAINT "iteration_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_organization_id_discipline_id_discipline_organization_id_id_fk" FOREIGN KEY ("organization_id","discipline_id") REFERENCES "public"."discipline"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_organization_id_discipline_id_discipline_organization_id_id_fk" FOREIGN KEY ("organization_id","discipline_id") REFERENCES "public"."discipline"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_status_fk" FOREIGN KEY ("organization_id","project_id","status_id") REFERENCES "public"."workflow_status"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_iteration_fk" FOREIGN KEY ("organization_id","project_id","iteration_id") REFERENCES "public"."iteration"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_team_fk" FOREIGN KEY ("organization_id","project_id","team_id") REFERENCES "public"."team"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_status" ADD CONSTRAINT "workflow_status_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_target_project_unique" ON "delivery_target" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iteration_one_active_per_project" ON "iteration" USING btree ("organization_id","project_id") WHERE "iteration"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_discipline_unique" ON "review_assignment" USING btree ("review_id","discipline_id") WHERE "review_assignment"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_assignment_discipline_idx" ON "review_assignment" USING btree ("organization_id","discipline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_project_active_name_unique" ON "team" USING btree ("organization_id","project_id",lower("name")) WHERE "team"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "work_item_project_rank_idx" ON "work_item" USING btree ("organization_id","project_id","rank");--> statement-breakpoint
CREATE INDEX "work_item_team_idx" ON "work_item" USING btree ("organization_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_status_project_active_name_unique" ON "workflow_status" USING btree ("organization_id","project_id",lower("name")) WHERE "workflow_status"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_connection_active_site_unique" ON "delivery_connection" USING btree ("organization_id","provider","base_url") WHERE "delivery_connection"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "delivery_connection" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "delivery_target" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "iteration" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "organization_onboarding" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "default_team_id";--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP COLUMN "role_id";--> statement-breakpoint
ALTER TABLE "review_assignment" DROP COLUMN "role_id";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "delivery_mode";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "readiness_policy";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "estimate_scale";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "iteration_mode";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "iteration_weeks";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "iteration_start_day";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "upcoming_iterations";--> statement-breakpoint
ALTER TABLE "team" DROP COLUMN "ai_action_policy";--> statement-breakpoint
ALTER TABLE "workflow_status" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_one_target" CHECK (("review_assignment"."user_id" IS NOT NULL) <> ("review_assignment"."discipline_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "organization_role" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_role_member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_project" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_work_item_type" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "configuration_assignment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "configuration_role" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "organization_role" CASCADE;--> statement-breakpoint
DROP TABLE "organization_role_member" CASCADE;--> statement-breakpoint
DROP TABLE "team_project" CASCADE;--> statement-breakpoint
DROP TABLE "team_work_item_type" CASCADE;--> statement-breakpoint
DROP TABLE "configuration_assignment" CASCADE;--> statement-breakpoint
DROP TABLE "configuration_role" CASCADE;
