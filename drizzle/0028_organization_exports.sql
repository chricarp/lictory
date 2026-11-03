CREATE TABLE "organization_export" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"format_version" integer NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp,
	"ready_attempt" integer,
	"size" bigint,
	"sha256" text,
	"summary" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "organization_export_status" CHECK ("organization_export"."status" in ('queued', 'running', 'ready', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "organization_export_chunk" (
	"export_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"sequence" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "organization_export_chunk_export_id_attempt_sequence_pk" PRIMARY KEY("export_id","attempt","sequence")
);
--> statement-breakpoint
ALTER TABLE "organization_export" ADD CONSTRAINT "organization_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_export_chunk" ADD CONSTRAINT "organization_export_chunk_export_id_organization_export_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."organization_export"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_export_org_idx" ON "organization_export" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_export_pending_idx" ON "organization_export" USING btree ("created_at") WHERE "organization_export"."status" in ('queued', 'running');