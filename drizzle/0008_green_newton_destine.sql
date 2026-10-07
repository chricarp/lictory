CREATE TABLE "team_project" (
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "team_project_team_id_project_id_pk" PRIMARY KEY("team_id","project_id")
);
--> statement-breakpoint
DROP INDEX "delivery_connection_active_site_unique";--> statement-breakpoint
DROP INDEX "configuration_role_active_name_unique";--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD COLUMN "parent_role_id" text;--> statement-breakpoint
ALTER TABLE "team_project" ADD CONSTRAINT "team_project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_project" ADD CONSTRAINT "team_project_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_project" ADD CONSTRAINT "team_project_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_project_org_project_idx" ON "team_project" USING btree ("organization_id","project_id");--> statement-breakpoint
ALTER TABLE "delivery_connection" ADD CONSTRAINT "delivery_connection_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD CONSTRAINT "configuration_role_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD CONSTRAINT "configuration_role_organization_id_team_id_team_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD CONSTRAINT "configuration_role_organization_id_parent_role_id_configuration_role_organization_id_id_fk" FOREIGN KEY ("organization_id","parent_role_id") REFERENCES "public"."configuration_role"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_connection_active_team_site_unique" ON "delivery_connection" USING btree ("organization_id","team_id","provider","base_url") WHERE "delivery_connection"."archived_at" IS NULL AND "delivery_connection"."team_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_connection_active_site_unique" ON "delivery_connection" USING btree ("organization_id","provider","base_url") WHERE "delivery_connection"."archived_at" IS NULL AND "delivery_connection"."team_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "configuration_role_active_name_unique" ON "configuration_role" USING btree ("organization_id","scope",coalesce("project_id", "team_id", ''),lower("name")) WHERE "configuration_role"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "configuration_role" ADD CONSTRAINT "configuration_role_local_scope" CHECK (("configuration_role"."project_id" is null or "configuration_role"."scope" = 'project') and ("configuration_role"."team_id" is null or "configuration_role"."scope" = 'team') and not ("configuration_role"."project_id" is not null and "configuration_role"."team_id" is not null) and (("configuration_role"."project_id" is null and "configuration_role"."team_id" is null) or "configuration_role"."parent_role_id" is not null));
--> statement-breakpoint
-- Preserve shared teams and infer every existing project association without
-- changing work, statuses, iteration history, delivery targets or identifiers.
INSERT INTO team_project (organization_id, team_id, project_id)
SELECT organization_id, team_id, project_id FROM work_item
UNION
SELECT organization_id, default_team_id, id FROM project WHERE default_team_id IS NOT NULL
ON CONFLICT DO NOTHING;
