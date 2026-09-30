CREATE TABLE "organization_onboarding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"team_id" text NOT NULL,
	"decided_by_id" text NOT NULL,
	"decisions" jsonb NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "onboarding_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "onboarding_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;