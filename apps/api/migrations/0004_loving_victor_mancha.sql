-- Preserve the model's detailed rundown separately from the short feed summary
-- and retain the timezone needed to resolve relative dates correctly.
ALTER TABLE notes ADD COLUMN ai_analysis TEXT;
--> statement-breakpoint
ALTER TABLE notes ADD COLUMN capture_timezone TEXT NOT NULL DEFAULT 'UTC';
--> statement-breakpoint

-- Time entities distinguish dates that are merely contextual from events,
-- deadlines, and reminders. Reminder suggestions stay correctable graph data;
-- they do not silently schedule a notification.
ALTER TABLE entities ADD COLUMN time_kind TEXT
  CHECK (time_kind IS NULL OR time_kind IN ('date', 'event', 'deadline', 'reminder'));
--> statement-breakpoint
ALTER TABLE entities ADD COLUMN needs_reminder INTEGER NOT NULL DEFAULT 0
  CHECK (needs_reminder IN (0, 1));
--> statement-breakpoint
ALTER TABLE entities ADD COLUMN reminder_reason TEXT;
