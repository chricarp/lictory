CREATE TABLE "specification_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"branch_id" text,
	"epoch" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"committed_sequence" integer DEFAULT 0 NOT NULL,
	"base_revision_id" text,
	"base_commit_id" text,
	"snapshot" "bytea",
	"snapshot_sequence" integer DEFAULT 0 NOT NULL,
	"fenced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "specification_draft_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "specification_draft_branch_unique" UNIQUE("branch_id"),
	CONSTRAINT "specification_draft_line_base" CHECK (("specification_draft"."branch_id" IS NULL AND "specification_draft"."base_revision_id" IS NOT NULL AND "specification_draft"."base_commit_id" IS NULL)
        OR ("specification_draft"."branch_id" IS NOT NULL AND "specification_draft"."base_commit_id" IS NOT NULL AND "specification_draft"."base_revision_id" IS NULL)),
	CONSTRAINT "specification_draft_epoch_positive" CHECK ("specification_draft"."epoch" > 0),
	CONSTRAINT "specification_draft_sequences" CHECK ("specification_draft"."sequence" >= 0 AND "specification_draft"."committed_sequence" >= 0 AND "specification_draft"."snapshot_sequence" >= 0
        AND "specification_draft"."committed_sequence" <= "specification_draft"."sequence" AND "specification_draft"."snapshot_sequence" <= "specification_draft"."sequence")
);
--> statement-breakpoint
CREATE TABLE "specification_draft_seed" (
	"organization_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"seed" "bytea" NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "specification_draft_seed_draft_id_epoch_pk" PRIMARY KEY("draft_id","epoch"),
	CONSTRAINT "specification_draft_seed_epoch_positive" CHECK ("specification_draft_seed"."epoch" > 0)
);
--> statement-breakpoint
CREATE TABLE "specification_draft_update" (
	"organization_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"sequence" integer NOT NULL,
	"author_id" text NOT NULL,
	"digest" "bytea" NOT NULL,
	"update" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "specification_draft_update_draft_id_sequence_pk" PRIMARY KEY("draft_id","sequence"),
	CONSTRAINT "specification_draft_update_digest_unique" UNIQUE("draft_id","epoch","digest")
);
--> statement-breakpoint
ALTER TABLE "specification_draft" ADD CONSTRAINT "specification_draft_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft" ADD CONSTRAINT "specification_draft_organization_id_work_item_id_work_item_organization_id_id_fk" FOREIGN KEY ("organization_id","work_item_id") REFERENCES "public"."work_item"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft" ADD CONSTRAINT "specification_draft_organization_id_work_item_id_branch_id_specification_branch_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","branch_id") REFERENCES "public"."specification_branch"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft" ADD CONSTRAINT "specification_draft_organization_id_work_item_id_base_revision_id_specification_revision_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","base_revision_id") REFERENCES "public"."specification_revision"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft" ADD CONSTRAINT "specification_draft_organization_id_work_item_id_base_commit_id_specification_commit_organization_id_work_item_id_id_fk" FOREIGN KEY ("organization_id","work_item_id","base_commit_id") REFERENCES "public"."specification_commit"("organization_id","work_item_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft_seed" ADD CONSTRAINT "specification_draft_seed_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft_seed" ADD CONSTRAINT "specification_draft_seed_organization_id_draft_id_specification_draft_organization_id_id_fk" FOREIGN KEY ("organization_id","draft_id") REFERENCES "public"."specification_draft"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft_update" ADD CONSTRAINT "specification_draft_update_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft_update" ADD CONSTRAINT "specification_draft_update_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_draft_update" ADD CONSTRAINT "specification_draft_update_organization_id_draft_id_specification_draft_organization_id_id_fk" FOREIGN KEY ("organization_id","draft_id") REFERENCES "public"."specification_draft"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "specification_draft_main_unique" ON "specification_draft" USING btree ("organization_id","work_item_id") WHERE "specification_draft"."branch_id" is null;--> statement-breakpoint
CREATE INDEX "specification_draft_item_idx" ON "specification_draft" USING btree ("organization_id","work_item_id");--> statement-breakpoint
-- Like `space_draft` (0036_space_draft_signal): fencing a specification
-- draft or starting a new epoch tells the collaboration service, after
-- commit, to close that draft's open rooms. A trigger, so every writer of
-- `specification_draft` signals. Identifiers only; the same channel, whose
-- payload the previous release already reads.
CREATE FUNCTION "specification_draft_replaced_signal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	draft "specification_draft";
BEGIN
	IF TG_OP = 'DELETE' THEN
		draft := OLD;
	ELSE
		draft := NEW;
	END IF;
	PERFORM pg_notify(
		'lictory_spaces_access',
		json_build_object(
			'organizationId', draft."organization_id",
			'draftIds', json_build_array(draft."id")
		)::text
	);
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "specification_draft_replaced_signal" AFTER UPDATE OF "epoch", "fenced_at" ON "specification_draft" FOR EACH ROW WHEN (NEW."epoch" IS DISTINCT FROM OLD."epoch" OR (NEW."fenced_at" IS NOT NULL AND OLD."fenced_at" IS NULL)) EXECUTE FUNCTION "specification_draft_replaced_signal"();--> statement-breakpoint
CREATE TRIGGER "specification_draft_deleted_signal" AFTER DELETE ON "specification_draft" FOR EACH ROW EXECUTE FUNCTION "specification_draft_replaced_signal"();
