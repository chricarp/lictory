-- Functional groups become organization roles: named member collections that
-- carry workflow capabilities. Pure renames preserve every row, membership and
-- review assignment; the new capability columns start false and the data
-- migration that follows sets them for existing rows. Long constraint names are
-- truncated by PostgreSQL identically on creation and here.
ALTER TABLE "functional_group" RENAME TO "organization_role";--> statement-breakpoint
ALTER TABLE "group_member" RENAME TO "organization_role_member";--> statement-breakpoint
ALTER TABLE "organization_role_member" RENAME COLUMN "group_id" TO "role_id";--> statement-breakpoint
ALTER TABLE "review_assignment" RENAME COLUMN "group_id" TO "role_id";--> statement-breakpoint
ALTER TABLE "organization_role" RENAME CONSTRAINT "group_org_id_unique" TO "role_org_id_unique";--> statement-breakpoint
ALTER TABLE "organization_role" RENAME CONSTRAINT "functional_group_organization_id_organization_id_fk" TO "organization_role_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "organization_role_member" RENAME CONSTRAINT "group_member_organization_id_organization_id_fk" TO "organization_role_member_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "organization_role_member" RENAME CONSTRAINT "group_member_user_id_user_id_fk" TO "organization_role_member_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "organization_role_member" RENAME CONSTRAINT "group_member_organization_id_group_id_functional_group_organization_id_id_fk" TO "organization_role_member_organization_id_role_id_organization_role_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "organization_role_member" RENAME CONSTRAINT "group_member_group_id_user_id_pk" TO "organization_role_member_role_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "review_assignment" RENAME CONSTRAINT "review_assignment_organization_id_group_id_functional_group_organization_id_id_fk" TO "review_assignment_organization_id_role_id_organization_role_organization_id_id_fk";--> statement-breakpoint
ALTER INDEX "group_member_org_user_idx" RENAME TO "role_member_org_user_idx";--> statement-breakpoint
ALTER INDEX "review_assignment_active_group_unique" RENAME TO "review_assignment_active_role_unique";--> statement-breakpoint
ALTER INDEX "review_assignment_group_idx" RENAME TO "review_assignment_role_idx";--> statement-breakpoint
-- Active role names are unique per organization (case-insensitive); an archived
-- role releases its name so it can be recreated.
ALTER TABLE "organization_role" DROP CONSTRAINT "group_org_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "role_org_active_name_unique" ON "organization_role" USING btree ("organization_id",lower("name")) WHERE "organization_role"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD CONSTRAINT "role_name_present" CHECK (length(trim("organization_role"."name")) > 0);--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "can_edit_specifications" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "can_change_properties" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "can_request_reviews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_role" ADD COLUMN "can_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_assignment" DROP CONSTRAINT "review_assignment_one_target";--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_one_target" CHECK (("review_assignment"."user_id" IS NOT NULL) <> ("review_assignment"."role_id" IS NOT NULL));
