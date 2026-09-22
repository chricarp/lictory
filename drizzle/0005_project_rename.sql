-- Physical rename: product → project, product_id → project_id. Pure renames
-- preserve every row, revision, approval and sync change. Constraint and index
-- names are renamed to what the schema snapshot expects.
ALTER TABLE "product" RENAME TO "project";--> statement-breakpoint
ALTER TABLE "label" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "milestone" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "work_item" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "decision" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "activity" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "sync_change" RENAME COLUMN "product_id" TO "project_id";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_org_id_unique" TO "project_org_id_unique";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_org_slug_unique" TO "project_org_slug_unique";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_org_key_unique" TO "project_org_key_unique";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_key_format" TO "project_key_format";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_organization_id_organization_id_fk" TO "project_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "project" RENAME CONSTRAINT "product_created_by_id_user_id_fk" TO "project_created_by_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "label" RENAME CONSTRAINT "label_product_name_unique" TO "label_project_name_unique";--> statement-breakpoint
ALTER TABLE "label" RENAME CONSTRAINT "label_organization_id_product_id_product_organization_id_id_fk" TO "label_organization_id_project_id_project_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "milestone" RENAME CONSTRAINT "milestone_product_name_unique" TO "milestone_project_name_unique";--> statement-breakpoint
ALTER TABLE "milestone" RENAME CONSTRAINT "milestone_organization_id_product_id_product_organization_id_id_fk" TO "milestone_organization_id_project_id_project_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "proposal_product_id_unique" TO "work_item_project_id_unique";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "work_item_product_number_unique" TO "work_item_project_number_unique";--> statement-breakpoint
ALTER TABLE "work_item" RENAME CONSTRAINT "work_item_organization_id_product_id_product_organization_id_id_fk" TO "work_item_organization_id_project_id_project_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "decision" RENAME CONSTRAINT "decision_organization_id_product_id_product_organization_id_id_fk" TO "decision_organization_id_project_id_project_organization_id_id_fk";--> statement-breakpoint
ALTER TABLE "decision" RENAME CONSTRAINT "decision_organization_id_product_id_work_item_id_work_item_organization_id_product_id_id_fk" TO "decision_organization_id_project_id_work_item_id_work_item_organization_id_project_id_id_fk";--> statement-breakpoint
ALTER INDEX "work_item_product_status_idx" RENAME TO "work_item_project_status_idx";--> statement-breakpoint
ALTER INDEX "decision_product_idx" RENAME TO "decision_project_idx";--> statement-breakpoint
-- The change log is replayed by clients; rewrite the persisted entity vocabulary
-- so history stays readable under protocol 3. jsonb text form is canonical
-- ("key": value), which makes these replacements exact.
UPDATE "sync_change" SET "change" = replace(replace("change"::text, '"productId": ', '"projectId": '), '"type": "product"', '"type": "project"')::jsonb WHERE "change"::text LIKE '%product%';
