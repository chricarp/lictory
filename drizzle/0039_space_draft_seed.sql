CREATE TABLE "space_draft_seed" (
	"organization_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"seed" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "space_draft_seed_draft_id_epoch_pk" PRIMARY KEY("draft_id","epoch"),
	CONSTRAINT "space_draft_seed_epoch_positive" CHECK ("space_draft_seed"."epoch" > 0)
);
--> statement-breakpoint
ALTER TABLE "space_draft_seed" ADD CONSTRAINT "space_draft_seed_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_draft_seed" ADD CONSTRAINT "space_draft_seed_organization_id_draft_id_space_draft_organization_id_id_fk" FOREIGN KEY ("organization_id","draft_id") REFERENCES "public"."space_draft"("organization_id","id") ON DELETE restrict ON UPDATE no action;