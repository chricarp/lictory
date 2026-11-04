CREATE TABLE "organization_deletion" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"requested_by_id" text NOT NULL,
	"requested_by_name" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"delete_after" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp,
	"started_at" timestamp,
	"files_deleted_at" timestamp,
	"error" text,
	CONSTRAINT "organization_deletion_status" CHECK ("organization_deletion"."status" in ('scheduled', 'deleting'))
);
--> statement-breakpoint
ALTER TABLE "instance_audit_event" DROP CONSTRAINT "instance_audit_event_via";--> statement-breakpoint
ALTER TABLE "organization_deletion" ADD CONSTRAINT "organization_deletion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_deletion_due_idx" ON "organization_deletion" USING btree ("delete_after");--> statement-breakpoint
ALTER TABLE "instance_audit_event" ADD CONSTRAINT "instance_audit_event_via" CHECK ("instance_audit_event"."via" in ('cli', 'web', 'worker'));