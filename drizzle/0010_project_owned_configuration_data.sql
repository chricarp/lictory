-- Moves delivery configuration from teams to projects, makes every team belong
-- to one project, and turns organization roles into project disciplines.
-- History (revisions, reviews, approvals, activity, iteration events, links)
-- is preserved; only configuration rows are rewritten.

-- Project settings come from the team that delivered the project's work.
UPDATE "project" p SET
  "delivery_mode" = t."delivery_mode",
  "readiness_policy" = t."readiness_policy",
  "estimate_scale" = t."estimate_scale",
  "iteration_mode" = t."iteration_mode",
  "iteration_weeks" = t."iteration_weeks",
  "iteration_start_day" = t."iteration_start_day",
  "upcoming_iterations" = t."upcoming_iterations",
  "ai_action_policy" = t."ai_action_policy"
FROM "team" t
WHERE t."organization_id" = p."organization_id" AND t."id" = p."default_team_id";
--> statement-breakpoint

-- Every team belongs to exactly one project: the project it is the default of,
-- else its first associated project, else the project holding most of its
-- work, else the organization's first project.
UPDATE "team" t SET "project_id" = coalesce(
  (SELECT p."id" FROM "project" p
    WHERE p."organization_id" = t."organization_id" AND p."default_team_id" = t."id"
    ORDER BY p."created_at" LIMIT 1),
  (SELECT tp."project_id" FROM "team_project" tp
    JOIN "project" p ON p."organization_id" = tp."organization_id" AND p."id" = tp."project_id"
    WHERE tp."organization_id" = t."organization_id" AND tp."team_id" = t."id"
    ORDER BY p."created_at" LIMIT 1),
  (SELECT w."project_id" FROM "work_item" w
    WHERE w."organization_id" = t."organization_id" AND w."team_id" = t."id"
    GROUP BY w."project_id" ORDER BY count(*) DESC LIMIT 1),
  (SELECT p."id" FROM "project" p
    WHERE p."organization_id" = t."organization_id"
    ORDER BY p."created_at" LIMIT 1));
--> statement-breakpoint

-- A team shared with other projects is split: each other project gets its own
-- copy (same members), and that project's work moves to the copy.
CREATE TEMPORARY TABLE "team_split" ON COMMIT DROP AS
SELECT x."organization_id", x."team_id", x."project_id", gen_random_uuid()::text AS "new_id"
FROM (
  SELECT DISTINCT s."organization_id", s."team_id", s."project_id"
  FROM (
    SELECT "organization_id", "team_id", "project_id" FROM "team_project"
    UNION
    SELECT "organization_id", "team_id", "project_id" FROM "work_item" WHERE "team_id" IS NOT NULL
  ) s
  JOIN "team" t ON t."organization_id" = s."organization_id" AND t."id" = s."team_id"
  WHERE s."project_id" <> t."project_id"
) x;
--> statement-breakpoint
INSERT INTO "team" ("id", "organization_id", "project_id", "name", "description", "created_at", "updated_at", "archived_at")
SELECT sp."new_id", t."organization_id", sp."project_id", t."name" || ' (' || p."key" || ')', t."description", t."created_at", now(), t."archived_at"
FROM "team_split" sp
JOIN "team" t ON t."organization_id" = sp."organization_id" AND t."id" = sp."team_id"
JOIN "project" p ON p."organization_id" = sp."organization_id" AND p."id" = sp."project_id";
--> statement-breakpoint
INSERT INTO "team_member" ("organization_id", "team_id", "user_id", "created_at")
SELECT m."organization_id", sp."new_id", m."user_id", m."created_at"
FROM "team_split" sp
JOIN "team_member" m ON m."organization_id" = sp."organization_id" AND m."team_id" = sp."team_id";
--> statement-breakpoint
UPDATE "work_item" w SET "team_id" = sp."new_id"
FROM "team_split" sp
WHERE w."organization_id" = sp."organization_id" AND w."team_id" = sp."team_id" AND w."project_id" = sp."project_id";
--> statement-breakpoint

-- Teams of organizations that never created a project cannot belong to one.
UPDATE "intelligence_context_entry" e SET "scope" = 'organization', "team_id" = NULL
FROM "team" t
WHERE e."organization_id" = t."organization_id" AND e."team_id" = t."id" AND t."project_id" IS NULL;
--> statement-breakpoint
UPDATE "delivery_connection" c SET "team_id" = NULL, "archived_at" = coalesce(c."archived_at", now())
FROM "team" t
WHERE c."organization_id" = t."organization_id" AND c."team_id" = t."id" AND t."project_id" IS NULL;
--> statement-breakpoint
DELETE FROM "iteration_event" e USING "iteration" i, "team" t
WHERE e."organization_id" = i."organization_id" AND e."iteration_id" = i."id"
  AND i."organization_id" = t."organization_id" AND i."team_id" = t."id" AND t."project_id" IS NULL;
--> statement-breakpoint
DELETE FROM "iteration" i USING "team" t
WHERE i."organization_id" = t."organization_id" AND i."team_id" = t."id" AND t."project_id" IS NULL;
--> statement-breakpoint
DELETE FROM "workflow_status" s USING "team" t
WHERE s."organization_id" = t."organization_id" AND s."team_id" = t."id" AND t."project_id" IS NULL;
--> statement-breakpoint

-- Project-scope configuration assignments that could administer a project
-- become project administrators; the delegated role model is retired (its
-- history stays in configuration_audit).
INSERT INTO "project_member" ("organization_id", "project_id", "user_id", "role")
SELECT DISTINCT a."organization_id", a."project_id", a."user_id", 'admin'::"project_role"
FROM "configuration_assignment" a
JOIN "configuration_role" r ON r."organization_id" = a."organization_id" AND r."id" = a."role_id"
JOIN "member" m ON m."organization_id" = a."organization_id" AND m."user_id" = a."user_id"
WHERE a."project_id" IS NOT NULL AND r."archived_at" IS NULL
  AND (r."permissions" @> '["manageAccess"]'::jsonb OR r."permissions" @> '["projectSettings"]'::jsonb)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Every organization member worked in every project before; keep that.
INSERT INTO "project_member" ("organization_id", "project_id", "user_id", "role")
SELECT p."organization_id", p."id", m."user_id", 'member'::"project_role"
FROM "project" p
JOIN "member" m ON m."organization_id" = p."organization_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
TRUNCATE "configuration_assignment", "configuration_role";
--> statement-breakpoint
DELETE FROM "team" t WHERE t."project_id" IS NULL;
--> statement-breakpoint

-- One workflow per project, copied from the project's main team (its default
-- team, else its oldest team), or the default workflow when it has no team.
CREATE TEMPORARY TABLE "project_source_team" ON COMMIT DROP AS
SELECT p."organization_id", p."id" AS "project_id", coalesce(
  (SELECT t."id" FROM "team" t
    WHERE t."organization_id" = p."organization_id" AND t."id" = p."default_team_id" AND t."project_id" = p."id"),
  (SELECT t."id" FROM "team" t
    WHERE t."organization_id" = p."organization_id" AND t."project_id" = p."id"
    ORDER BY (t."archived_at" IS NULL) DESC, t."created_at" LIMIT 1)) AS "team_id"
FROM "project" p;
--> statement-breakpoint
INSERT INTO "workflow_status" ("id", "organization_id", "project_id", "team_id", "name", "color", "category", "position", "created_at", "updated_at", "archived_at")
SELECT gen_random_uuid()::text, s."organization_id", ps."project_id", NULL, s."name", s."color", s."category", s."position", s."created_at", now(), s."archived_at"
FROM "project_source_team" ps
JOIN "workflow_status" s ON s."organization_id" = ps."organization_id" AND s."team_id" = ps."team_id";
--> statement-breakpoint
INSERT INTO "workflow_status" ("id", "organization_id", "project_id", "name", "color", "category", "position")
SELECT gen_random_uuid()::text, ps."organization_id", ps."project_id", d."name", d."color", d."category"::"status_category", d."position"
FROM "project_source_team" ps
CROSS JOIN (VALUES
  ('Backlog', 'gray', 'backlog', 0),
  ('Todo', 'gray', 'unstarted', 1),
  ('In Progress', 'amber', 'started', 2),
  ('In Review', 'blue', 'started', 3),
  ('Done', 'green', 'done', 4),
  ('Canceled', 'gray', 'canceled', 5)
) AS d("name", "color", "category", "position")
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_status" s
  WHERE s."organization_id" = ps."organization_id" AND s."project_id" = ps."project_id" AND s."archived_at" IS NULL
);
--> statement-breakpoint
-- Items keep a status of the same name and category, else the first active
-- status of the same category, else the project's first active status.
UPDATE "work_item" w SET "status_id" = coalesce(
  (SELECT n."id" FROM "workflow_status" n, "workflow_status" o
    WHERE o."organization_id" = w."organization_id" AND o."id" = w."status_id"
      AND n."organization_id" = w."organization_id" AND n."project_id" = w."project_id"
      AND lower(n."name") = lower(o."name") AND n."category" = o."category"
    ORDER BY (n."archived_at" IS NULL) DESC, n."position" LIMIT 1),
  (SELECT n."id" FROM "workflow_status" n, "workflow_status" o
    WHERE o."organization_id" = w."organization_id" AND o."id" = w."status_id"
      AND n."organization_id" = w."organization_id" AND n."project_id" = w."project_id"
      AND n."category" = o."category" AND n."archived_at" IS NULL
    ORDER BY n."position" LIMIT 1),
  (SELECT n."id" FROM "workflow_status" n
    WHERE n."organization_id" = w."organization_id" AND n."project_id" = w."project_id"
    ORDER BY (n."archived_at" IS NULL) DESC, n."position" LIMIT 1));
--> statement-breakpoint
DELETE FROM "workflow_status" WHERE "project_id" IS NULL;
--> statement-breakpoint

-- Enabled types: everything the project's teams used, plus every type its
-- work already has; projects without either enable every active type.
INSERT INTO "project_work_item_type" ("organization_id", "project_id", "type_id")
SELECT DISTINCT t."organization_id", t."project_id", x."type_id"
FROM "team" t
JOIN "team_work_item_type" x ON x."organization_id" = t."organization_id" AND x."team_id" = t."id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "project_work_item_type" ("organization_id", "project_id", "type_id")
SELECT DISTINCT "organization_id", "project_id", "type_id" FROM "work_item"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "project_work_item_type" ("organization_id", "project_id", "type_id")
SELECT p."organization_id", p."id", y."id"
FROM "project" p
JOIN "work_item_type" y ON y."organization_id" = p."organization_id" AND y."archived_at" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "project_work_item_type" e
  WHERE e."organization_id" = p."organization_id" AND e."project_id" = p."id"
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Iterations belong to their team's project. Numbers become per project; at
-- most one iteration per project stays active (the most recently started).
UPDATE "iteration" i SET "project_id" = t."project_id"
FROM "team" t
WHERE t."organization_id" = i."organization_id" AND t."id" = i."team_id";
--> statement-breakpoint
UPDATE "work_item" w SET "iteration_id" = NULL
WHERE w."iteration_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "iteration" i
  WHERE i."organization_id" = w."organization_id" AND i."id" = w."iteration_id" AND i."project_id" = w."project_id"
);
--> statement-breakpoint
UPDATE "iteration" i SET "state" = 'completed', "completed_at" = now()
WHERE i."state" = 'active' AND EXISTS (
  SELECT 1 FROM "iteration" o
  WHERE o."organization_id" = i."organization_id" AND o."project_id" = i."project_id"
    AND o."state" = 'active' AND o."id" <> i."id"
    AND (o."started_at" > i."started_at" OR (o."started_at" = i."started_at" AND o."id" > i."id"))
);
--> statement-breakpoint
UPDATE "iteration" SET "number" = "number" + 1000000;
--> statement-breakpoint
UPDATE "iteration" i SET "number" = r."n"
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "project_id"
    ORDER BY "starts_at", "number", "created_at"
  ) AS "n"
  FROM "iteration"
) r
WHERE r."id" = i."id";
--> statement-breakpoint

-- Organization roles become disciplines of every project, with the same
-- capabilities and members; review responsibilities follow their project.
CREATE TEMPORARY TABLE "discipline_split" ON COMMIT DROP AS
SELECT r."organization_id", r."id" AS "role_id", p."id" AS "project_id", gen_random_uuid()::text AS "discipline_id"
FROM "organization_role" r
JOIN "project" p ON p."organization_id" = r."organization_id";
--> statement-breakpoint
INSERT INTO "discipline" ("id", "organization_id", "project_id", "name", "description", "can_edit_specifications", "can_change_properties", "can_request_reviews", "can_review", "can_publish_delivery", "created_at", "updated_at", "archived_at")
SELECT d."discipline_id", r."organization_id", d."project_id", r."name", r."description", r."can_edit_specifications", r."can_change_properties", r."can_request_reviews", r."can_review", r."can_publish_delivery", r."created_at", r."updated_at", r."archived_at"
FROM "discipline_split" d
JOIN "organization_role" r ON r."organization_id" = d."organization_id" AND r."id" = d."role_id";
--> statement-breakpoint
INSERT INTO "discipline_member" ("organization_id", "discipline_id", "user_id", "created_at")
SELECT d."organization_id", d."discipline_id", m."user_id", m."created_at"
FROM "discipline_split" d
JOIN "organization_role_member" m ON m."organization_id" = d."organization_id" AND m."role_id" = d."role_id"
JOIN "project_member" pm ON pm."organization_id" = d."organization_id" AND pm."project_id" = d."project_id" AND pm."user_id" = m."user_id";
--> statement-breakpoint
UPDATE "review_assignment" a SET "discipline_id" = d."discipline_id"
FROM "review" r, "work_item" w, "discipline_split" d
WHERE a."role_id" IS NOT NULL
  AND r."organization_id" = a."organization_id" AND r."id" = a."review_id"
  AND w."organization_id" = r."organization_id" AND w."id" = r."work_item_id"
  AND d."organization_id" = a."organization_id" AND d."role_id" = a."role_id" AND d."project_id" = w."project_id";
--> statement-breakpoint
UPDATE "pull_request_review" x SET "discipline_id" = d."discipline_id"
FROM "work_item" w, "discipline_split" d
WHERE w."organization_id" = x."organization_id" AND w."id" = x."work_item_id"
  AND d."organization_id" = x."organization_id" AND d."role_id" = x."role_id" AND d."project_id" = w."project_id";
--> statement-breakpoint

-- Jira connections are organization-owned. A team's duplicate connection to a
-- site the organization (or an older team connection) already uses is
-- archived; its links, targets and history move to the surviving connection.
CREATE TEMPORARY TABLE "connection_survivor" ON COMMIT DROP AS
SELECT c."organization_id", c."id", first_value(c."id") OVER (
  PARTITION BY c."organization_id", c."provider", c."base_url"
  ORDER BY (c."team_id" IS NULL) DESC, c."created_at", c."id"
) AS "survivor_id"
FROM "delivery_connection" c
WHERE c."archived_at" IS NULL;
--> statement-breakpoint
UPDATE "work_item_external_link" l SET "connection_id" = s."survivor_id"
FROM "connection_survivor" s
WHERE s."id" <> s."survivor_id" AND l."organization_id" = s."organization_id" AND l."connection_id" = s."id"
  AND NOT EXISTS (
    SELECT 1 FROM "work_item_external_link" o
    WHERE o."organization_id" = l."organization_id" AND o."connection_id" = s."survivor_id"
      AND (o."work_item_id" = l."work_item_id" OR o."external_id" = l."external_id")
  );
--> statement-breakpoint
UPDATE "delivery_target" g SET "connection_id" = s."survivor_id"
FROM "connection_survivor" s
WHERE s."id" <> s."survivor_id" AND g."organization_id" = s."organization_id" AND g."connection_id" = s."id";
--> statement-breakpoint
UPDATE "delivery_connection" c SET "archived_at" = now()
FROM "connection_survivor" s
WHERE s."id" <> s."survivor_id" AND c."organization_id" = s."organization_id" AND c."id" = s."id";
--> statement-breakpoint

-- Export targets belong to projects. A team target moves to the team's
-- project; the organization default applies to every project without one.
UPDATE "delivery_target" g SET "project_id" = t."project_id"
FROM "team" t
WHERE g."team_id" IS NOT NULL AND t."organization_id" = g."organization_id" AND t."id" = g."team_id";
--> statement-breakpoint
INSERT INTO "delivery_target" ("id", "organization_id", "connection_id", "project_id", "external_project_id", "external_project_key", "type_mapping", "created_at", "updated_at")
SELECT gen_random_uuid()::text, g."organization_id", g."connection_id", p."id", g."external_project_id", g."external_project_key", g."type_mapping", g."created_at", now()
FROM "delivery_target" g
JOIN "project" p ON p."organization_id" = g."organization_id"
WHERE g."team_id" IS NULL AND g."project_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "delivery_target" o
    WHERE o."organization_id" = g."organization_id" AND o."project_id" = p."id"
  );
--> statement-breakpoint
DELETE FROM "delivery_target" WHERE "project_id" IS NULL;
--> statement-breakpoint
DELETE FROM "delivery_target" g
USING "project" p
WHERE p."organization_id" = g."organization_id" AND p."id" = g."project_id"
  AND EXISTS (
    SELECT 1 FROM "delivery_target" o
    WHERE o."organization_id" = g."organization_id" AND o."project_id" = g."project_id" AND o."id" <> g."id"
      AND (
        (o."team_id" IS NOT DISTINCT FROM p."default_team_id") > (g."team_id" IS NOT DISTINCT FROM p."default_team_id")
        OR ((o."team_id" IS NOT DISTINCT FROM p."default_team_id") = (g."team_id" IS NOT DISTINCT FROM p."default_team_id")
          AND (o."created_at", o."id") < (g."created_at", g."id"))
      )
  );
