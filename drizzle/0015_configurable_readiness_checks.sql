CREATE TABLE "readiness_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"summary" text,
	"author_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "readiness_revision_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "readiness_revision_project_number_unique" UNIQUE("organization_id","project_id","number"),
	CONSTRAINT "readiness_revision_positive_number" CHECK ("readiness_revision"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "readiness_sign_off" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"check_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	"withdrawn_by_id" text,
	CONSTRAINT "readiness_sign_off_withdrawal_consistent" CHECK (("readiness_sign_off"."withdrawn_at" IS NULL) = ("readiness_sign_off"."withdrawn_by_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "work_item" ADD COLUMN "readiness_revision_id" text;--> statement-breakpoint
ALTER TABLE "readiness_revision" ADD CONSTRAINT "readiness_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_revision" ADD CONSTRAINT "readiness_revision_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_revision" ADD CONSTRAINT "readiness_revision_organization_id_project_id_project_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_sign_off" ADD CONSTRAINT "readiness_sign_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_sign_off" ADD CONSTRAINT "readiness_sign_off_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_sign_off" ADD CONSTRAINT "readiness_sign_off_withdrawn_by_id_user_id_fk" FOREIGN KEY ("withdrawn_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_sign_off" ADD CONSTRAINT "readiness_sign_off_organization_id_work_item_id_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_sign_off_active_unique" ON "readiness_sign_off" USING btree ("work_item_id","revision_id","check_id") WHERE "readiness_sign_off"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "readiness_sign_off_item_idx" ON "readiness_sign_off" USING btree ("organization_id","work_item_id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_readiness_revision_fk" FOREIGN KEY ("organization_id","readiness_revision_id") REFERENCES "public"."readiness_revision"("organization_id","id") ON DELETE restrict ON UPDATE no action;