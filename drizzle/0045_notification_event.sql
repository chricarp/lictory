CREATE TABLE "notification_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"notices" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"failed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_event_pending_idx" ON "notification_event" USING btree ("next_attempt_at") WHERE "notification_event"."failed_at" is null;