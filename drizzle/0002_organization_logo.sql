CREATE TABLE "organization_logo" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" "bytea" NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_logo_organization_id_kind_pk" PRIMARY KEY("organization_id","kind"),
	CONSTRAINT "organization_logo_kind" CHECK ("organization_logo"."kind" in ('mark', 'full'))
);
--> statement-breakpoint
ALTER TABLE "organization_logo" ADD CONSTRAINT "organization_logo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_logo" ADD CONSTRAINT "organization_logo_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;