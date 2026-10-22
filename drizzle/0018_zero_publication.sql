-- The only data Zero may replicate to zero-cache: read projections and the
-- membership columns used for live tenant authorization in synced queries.
-- Never add credentials, sessions, tokens or raw domain tables here.
CREATE PUBLICATION "lictory_zero" FOR TABLE
  "sync_entity",
  "member" ("id", "organization_id", "user_id", "role");
