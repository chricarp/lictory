ALTER TABLE "work_item_claim" ADD COLUMN "session_waiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "started_by_policy" jsonb;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "context" text;