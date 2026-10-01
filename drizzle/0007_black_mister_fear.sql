ALTER TABLE "work_item" ADD COLUMN "main_protected" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE work_item SET main_protected = true WHERE refinement_state = 'ready';
