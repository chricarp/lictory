-- Lictory Spaces read projections and effective access, replicated by Zero
-- (an expand: the previous release neither reads nor writes these tables).
-- `space_entity` carries Spaces projections apart from `sync_entity`, so the
-- organization and work item queries can never return space data;
-- `space_reader` is the effective access every Spaces query authorizes
-- through. Never add credentials, sessions, tokens, private configuration or
-- raw domain tables (spaces, pages, commits, drafts) here.
ALTER PUBLICATION "lictory_zero" ADD TABLE "space_entity", "space_reader";
