ALTER TABLE "intelligence_context_entry" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "intelligence_context_version" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_idempotency_unique" UNIQUE("organization_id","created_by_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "intelligence_context_version" ADD CONSTRAINT "intelligence_context_version_idempotency_unique" UNIQUE("organization_id","author_id","idempotency_key");