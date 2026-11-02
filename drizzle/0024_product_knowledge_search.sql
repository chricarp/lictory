-- Product knowledge search matches decision text with ILIKE. pg_trgm is a
-- trusted contrib extension, so the database owner (the migration role) may
-- create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "decision_title_trgm_idx" ON "decision" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "decision_body_trgm_idx" ON "decision" USING gin ("body" gin_trgm_ops);