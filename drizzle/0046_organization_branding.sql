CREATE TABLE "organization_branding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"brand_color" text,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_branding_brand_color" CHECK ("organization_branding"."brand_color" is null or "organization_branding"."brand_color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "organization_logo" DROP CONSTRAINT "organization_logo_kind";--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branding" ADD CONSTRAINT "organization_branding_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_logo" ADD CONSTRAINT "organization_logo_kind" CHECK ("organization_logo"."kind" in ('mark', 'full', 'icon'));