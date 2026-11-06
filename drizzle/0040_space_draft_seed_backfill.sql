-- Keeps the seed of every live draft's current epoch, so the epoch stays
-- reconstructable after the next restore or merge replaces it. Until now the
-- only copy was `space_draft.snapshot`, which holds exactly the current
-- epoch's seed (drafts are not compacted yet). Idempotent; Spaces drafts are
-- few, so this runs in the release transaction.
INSERT INTO "space_draft_seed" ("organization_id", "draft_id", "epoch", "seed", "created_at")
SELECT "organization_id", "id", "epoch", "snapshot", "updated_at"
FROM "space_draft"
WHERE "snapshot" IS NOT NULL
ON CONFLICT ("draft_id", "epoch") DO NOTHING;
