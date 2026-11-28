ALTER TABLE "runner" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "runner" ADD COLUMN "last_error_at" timestamp with time zone;