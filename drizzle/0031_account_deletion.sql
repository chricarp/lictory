CREATE TABLE "former_member" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"left_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "former_member_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "former_member" ADD CONSTRAINT "former_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "former_member" ADD CONSTRAINT "former_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "former_member_user_idx" ON "former_member" USING btree ("user_id");--> statement-breakpoint
-- People who left before this table existed, as far as the audit log records
-- it (removals and departures name the person). Directories pick them up on
-- their next refresh.
INSERT INTO "former_member" ("organization_id", "user_id", "left_at")
SELECT d."organization_id", d."user_id", d."left_at"
FROM (
	SELECT e."organization_id", coalesce(e."target_id", e."actor_id") AS "user_id", max(e."created_at") AS "left_at"
	FROM "audit_event" e
	WHERE e."action" IN ('member.removed', 'member.left')
	GROUP BY 1, 2
) d
JOIN "user" u ON u."id" = d."user_id"
WHERE NOT EXISTS (
	SELECT 1 FROM "member" m
	WHERE m."organization_id" = d."organization_id" AND m."user_id" = d."user_id"
)
ON CONFLICT DO NOTHING;
