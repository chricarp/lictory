-- The Factory's read projections and agent session event log, replicated by
-- Zero (an expand: the previous release neither reads nor writes these
-- tables). `factory_entity` holds protocol projections of agents, runners
-- and session summaries, built only by factory/entities.ts; the event log
-- holds bounded payloads shaped for synchronization. Both authorize through
-- organization membership. Never add the domain tables (agent, runner,
-- runner_registration, agent_session, agent_session_input, agent_approval):
-- they hold credential hashes, lease tokens and private steering inputs.
ALTER PUBLICATION "lictory_zero" ADD TABLE "factory_entity", "agent_session_event";
