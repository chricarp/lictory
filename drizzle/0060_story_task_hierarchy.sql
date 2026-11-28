ALTER TABLE "work_item_type" DROP CONSTRAINT "work_item_type_level";--> statement-breakpoint
ALTER TABLE "delivery_target" ADD COLUMN "type_hierarchy" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_level" CHECK ("work_item_type"."level" BETWEEN 0 AND 4);
--> statement-breakpoint

-- A Story breaks down into Tasks and Bugs: the default levels become
-- Epic 3 > Story 2 > Task/Bug 1 > Subtask 0. Existing type levels move to the
-- new scale by role, not by name, so renamed and custom types follow:
--   - level 2 and above (Epic and any grouping type above it) move up one;
--   - level 1 types that carry a specification (Story, or what an
--     organization made of it) move to 2;
--   - level 1 plain types (Task, Bug, custom plain work) and level 0 stay.
-- The mapping keeps every strict order: each parent stays strictly above its
-- children and grouping types stay grouping types. Items are not touched.
-- One statement, run once by the migration journal.
UPDATE "work_item_type"
SET "level" = CASE WHEN "level" >= 2 THEN "level" + 1 ELSE 2 END,
  "updated_at" = now()
WHERE "level" >= 2 OR ("level" = 1 AND "has_specification");
--> statement-breakpoint

-- The directory projection lists the types with their levels: rewrite only
-- the levels, so clients see the new hierarchy without waiting for the next
-- configuration change to refresh it.
UPDATE "sync_entity" se
SET "data" = jsonb_set(se."data", '{types}', (
    SELECT coalesce(jsonb_agg(
      CASE WHEN t."id" IS NULL THEN x.e
        ELSE jsonb_set(x.e, '{level}', to_jsonb(t."level")) END
      ORDER BY x.o), '[]'::jsonb)
    FROM jsonb_array_elements(se."data"->'types') WITH ORDINALITY AS x(e, o)
    LEFT JOIN "work_item_type" t
      ON t."organization_id" = se."organization_id" AND t."id" = x.e->>'id'
  )),
  "updated_at" = now()
WHERE se."type" = 'directory' AND jsonb_typeof(se."data"->'types') = 'array';
