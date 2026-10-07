CREATE TABLE "configuration_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role_id" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"team_id" text,
	CONSTRAINT "configuration_assignment_one_scope" CHECK (("configuration_assignment"."project_id" is not null) <> ("configuration_assignment"."team_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "configuration_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuration_role" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "configuration_role_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "configuration_role_scope" CHECK ("configuration_role"."scope" in ('project', 'team')),
	CONSTRAINT "configuration_role_name" CHECK (length(trim("configuration_role"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "configuration_assignment" ADD CONSTRAINT "configuration_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_assignment" ADD CONSTRAINT "configuration_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_assignment" ADD CONSTRAINT "configuration_assignment_organization_id_role_id_configuration_role_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."configuration_role"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_assignment" ADD CONSTRAINT "configuration_assignment_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_assignment" ADD CONSTRAINT "configuration_assignment_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_audit" ADD CONSTRAINT "configuration_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD CONSTRAINT "configuration_role_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "configuration_assignment_project_unique" ON "configuration_assignment" USING btree ("role_id","user_id","project_id") WHERE "configuration_assignment"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "configuration_assignment_team_unique" ON "configuration_assignment" USING btree ("role_id","user_id","team_id") WHERE "configuration_assignment"."team_id" is not null;--> statement-breakpoint
CREATE INDEX "configuration_assignment_org_user_idx" ON "configuration_assignment" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "configuration_audit_org_idx" ON "configuration_audit" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "configuration_role_active_name_unique" ON "configuration_role" USING btree ("organization_id","scope",lower("name")) WHERE "configuration_role"."archived_at" IS NULL;