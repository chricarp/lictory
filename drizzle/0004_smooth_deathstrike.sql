CREATE TABLE "file_object" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ready_at" timestamp,
	"removed_at" timestamp,
	CONSTRAINT "file_object_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "file_object_size_positive" CHECK ("file_object"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_project_id_work_item_id_work_item_organization_id_project_id_id_fk" FOREIGN KEY ("organization_id","project_id","work_item_id") REFERENCES "public"."work_item"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_object_item_idx" ON "file_object" USING btree ("organization_id","work_item_id");