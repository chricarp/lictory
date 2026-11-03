CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_action_present" CHECK (length("audit_event"."action") > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_idx" ON "audit_event" USING btree ("organization_id","created_at","id");--> statement-breakpoint
-- Audit entries are append-only. Updates are refused; deletes are refused
-- unless the organization itself is gone (its deletion cascades).
CREATE FUNCTION "audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND NOT EXISTS (
		SELECT 1 FROM "organization" WHERE "id" = OLD."organization_id"
	) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'Audit entries cannot be changed or deleted (% on %).', TG_OP, TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION "audit_append_only"();--> statement-breakpoint
CREATE TRIGGER "configuration_audit_append_only" BEFORE UPDATE OR DELETE ON "configuration_audit" FOR EACH ROW EXECUTE FUNCTION "audit_append_only"();
