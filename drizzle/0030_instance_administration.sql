CREATE TABLE "instance_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"actor_email" text,
	"via" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_audit_event_action_present" CHECK (length("instance_audit_event"."action") > 0),
	CONSTRAINT "instance_audit_event_via" CHECK ("instance_audit_event"."via" in ('cli', 'web'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "instance_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
CREATE INDEX "instance_audit_event_created_idx" ON "instance_audit_event" USING btree ("created_at","id");--> statement-breakpoint
-- Instance administration history is append-only: no organization owns it,
-- so nothing deletes it.
CREATE FUNCTION "instance_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Instance audit entries cannot be changed or deleted (% on %).', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "instance_audit_event_append_only" BEFORE UPDATE OR DELETE ON "instance_audit_event" FOR EACH ROW EXECUTE FUNCTION "instance_audit_append_only"();
