-- Fencing a live draft or replacing its content with a new epoch tells the
-- collaboration service, after commit, to close that draft's open rooms
-- (their clients reconnect to the current epoch or learn the draft is
-- closed). A trigger rather than a call in each command, so every writer of
-- `space_draft` signals, including ones added later. The payload carries
-- identifiers only (packages/core/src/spaces/signals.ts). An expand: the
-- previous release ignores the channel.
CREATE FUNCTION "space_draft_replaced_signal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	draft "space_draft";
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
CREATE TRIGGER "space_draft_replaced_signal" AFTER UPDATE OF "epoch", "fenced_at" ON "space_draft" FOR EACH ROW WHEN (NEW."epoch" IS DISTINCT FROM OLD."epoch" OR (NEW."fenced_at" IS NOT NULL AND OLD."fenced_at" IS NULL)) EXECUTE FUNCTION "space_draft_replaced_signal"();--> statement-breakpoint
CREATE TRIGGER "space_draft_deleted_signal" AFTER DELETE ON "space_draft" FOR EACH ROW EXECUTE FUNCTION "space_draft_replaced_signal"();
