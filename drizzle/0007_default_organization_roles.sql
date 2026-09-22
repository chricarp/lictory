-- Existing functional groups were review targets: they keep working as reviewer
-- roles. Every existing organization receives the default roles it would have
-- been created with, and its administrators join Product so someone can edit.
UPDATE "organization_role"
SET "can_review" = true, "can_request_reviews" = true;--> statement-breakpoint
INSERT INTO "organization_role" ("id", "organization_id", "name", "can_edit_specifications", "can_change_properties", "can_request_reviews", "can_review")
SELECT gen_random_uuid()::text, o."id", d."name", d."edit", d."props", d."request", d."review"
FROM "organization" o
CROSS JOIN (VALUES
  ('Product', true, true, true, true),
  ('Engineering', false, false, true, true),
  ('QA', false, false, true, true)
) AS d("name", "edit", "props", "request", "review")
WHERE NOT EXISTS (
  SELECT 1 FROM "organization_role" r
  WHERE r."organization_id" = o."id" AND lower(r."name") = lower(d."name") AND r."archived_at" IS NULL
);--> statement-breakpoint
INSERT INTO "organization_role_member" ("organization_id", "role_id", "user_id")
SELECT m."organization_id", r."id", m."user_id"
FROM "member" m
JOIN "organization_role" r
  ON r."organization_id" = m."organization_id" AND r."name" = 'Product' AND r."archived_at" IS NULL
WHERE m."role" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
