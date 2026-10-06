CREATE TABLE "access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "access_token_scope" CHECK ("access_token"."scope" in ('read', 'write')),
	CONSTRAINT "access_token_name_present" CHECK (length(trim("access_token"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "capability_invocation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"surface" text NOT NULL,
	"token_id" text,
	"client" text,
	"capability" text NOT NULL,
	"outcome" text NOT NULL,
	"mutation_id" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_invocation" ADD CONSTRAINT "capability_invocation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_invocation" ADD CONSTRAINT "capability_invocation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_invocation" ADD CONSTRAINT "capability_invocation_token_id_access_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."access_token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_hash_idx" ON "access_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "access_token_user_idx" ON "access_token" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "capability_invocation_user_idx" ON "capability_invocation" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "capability_invocation_org_idx" ON "capability_invocation" USING btree ("organization_id","created_at");