ALTER TABLE "specification_commit" ADD COLUMN "proposed_children" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "committed_revision_id" text;--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "delivered_revision_id" text;