-- Code read projections, replicated by Zero (an expand: the previous
-- release neither reads nor writes this table). `code_entity` carries the
-- Code module's projections apart from `sync_entity`, so the organization
-- and work item queries never return code rows. Never add credentials,
-- webhook secrets, deliveries, the outbox or raw mirror tables here.
ALTER PUBLICATION "lictory_zero" ADD TABLE "code_entity";
