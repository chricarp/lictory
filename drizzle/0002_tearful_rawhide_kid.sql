CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_change" (
	"organization_id" text NOT NULL,
	"cursor" bigint NOT NULL,
	"product_id" text NOT NULL,
	"proposal_id" text,
	"change" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_change_organization_id_cursor_pk" PRIMARY KEY("organization_id","cursor")
);
--> statement-breakpoint
CREATE TABLE "sync_clock" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"cursor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mutation" (
	"organization_id" text NOT NULL,
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"cursor" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sync_mutation_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_change" ADD CONSTRAINT "sync_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_clock" ADD CONSTRAINT "sync_clock_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_mutation" ADD CONSTRAINT "sync_mutation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_proposal_idx" ON "activity" USING btree ("organization_id","proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_scope_cursor_idx" ON "sync_change" USING btree ("organization_id","product_id","cursor");