CREATE TABLE "intelligence_context_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text NOT NULL,
	"project_id" text,
	"team_id" text,
	"kind" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	"archived_by_id" text,
	CONSTRAINT "intelligence_context_entry_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "intelligence_context_entry_scope_target" CHECK (("intelligence_context_entry"."scope" = 'organization' AND "intelligence_context_entry"."project_id" IS NULL AND "intelligence_context_entry"."team_id" IS NULL)
        OR ("intelligence_context_entry"."scope" = 'project' AND "intelligence_context_entry"."project_id" IS NOT NULL AND "intelligence_context_entry"."team_id" IS NULL)
        OR ("intelligence_context_entry"."scope" = 'team' AND "intelligence_context_entry"."team_id" IS NOT NULL AND "intelligence_context_entry"."project_id" IS NULL)),
	CONSTRAINT "intelligence_context_entry_kind" CHECK ("intelligence_context_entry"."kind" in ('note', 'document'))
);
--> statement-breakpoint
CREATE TABLE "intelligence_context_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source_filename" text,
	"source_format" text,
	"source_size" integer,
	"source_sha256" text,
	"author_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_context_version_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "intelligence_context_version_number_unique" UNIQUE("organization_id","entry_id","number"),
	CONSTRAINT "intelligence_context_version_title_present" CHECK (length(trim("intelligence_context_version"."title")) > 0),
	CONSTRAINT "intelligence_context_version_number" CHECK ("intelligence_context_version"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_run" ADD COLUMN "intelligence_context" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_archived_by_id_user_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_entry" ADD CONSTRAINT "intelligence_context_entry_team_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."team"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_version" ADD CONSTRAINT "intelligence_context_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_version" ADD CONSTRAINT "intelligence_context_version_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_context_version" ADD CONSTRAINT "intelligence_context_version_entry_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "public"."intelligence_context_entry"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_context_entry_scope_idx" ON "intelligence_context_entry" USING btree ("organization_id","scope","project_id","team_id");