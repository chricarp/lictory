CREATE TABLE "invitation_placement" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"discipline_ids" jsonb NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "invitation_placement" ADD CONSTRAINT "invitation_placement_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_placement" ADD CONSTRAINT "invitation_placement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_placement_org_idx" ON "invitation_placement" USING btree ("organization_id");