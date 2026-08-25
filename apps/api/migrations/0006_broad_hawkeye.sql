PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entity_moments` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'date' NOT NULL,
	`precision` text DEFAULT 'unknown' NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`all_day` integer DEFAULT 0 NOT NULL,
	`timezone` text,
	`recurrence_freq` text,
	`recurrence_interval` integer DEFAULT 1 NOT NULL,
	`recurrence_until` text,
	`recurrence_text` text,
	`next_occurrence_at` text,
	`needs_reminder` integer DEFAULT 0 NOT NULL,
	`reminder_reason` text,
	`remind_at` text,
	`trigger_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_moments_kind_check" CHECK("__new_entity_moments"."kind" in ('date', 'event', 'deadline', 'reminder')),
	CONSTRAINT "entity_moments_precision_check" CHECK("__new_entity_moments"."precision" in ('minute', 'day', 'month', 'year', 'unknown')),
	CONSTRAINT "entity_moments_recurrence_check" CHECK("__new_entity_moments"."recurrence_freq" is null or "__new_entity_moments"."recurrence_freq" in ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "entity_moments_all_day_check" CHECK("__new_entity_moments"."all_day" in (0, 1)),
	CONSTRAINT "entity_moments_needs_reminder_check" CHECK("__new_entity_moments"."needs_reminder" in (0, 1))
);
--> statement-breakpoint
-- Timing moves out of `entities` and into the moment itself. The old columns
-- stay behind as a mirror for clients that still read them, but from here on a
-- single write path owns both, so they cannot disagree.
INSERT INTO `__new_entity_moments` (
  "entity_id", "user_id", "kind", "precision",
  "starts_at", "ends_at", "all_day", "timezone",
  "recurrence_freq", "recurrence_interval", "recurrence_until", "recurrence_text",
  "next_occurrence_at", "needs_reminder", "reminder_reason",
  "remind_at", "trigger_id", "created_at", "updated_at"
)
SELECT
  m."entity_id",
  m."user_id",
  m."kind",
  m."precision",
  e."starts_at",
  e."ends_at",
  e."all_day",
  e."timezone",
  CASE
    WHEN e."recurrence" IS NULL THEN NULL
    WHEN lower(e."recurrence") LIKE '%year%'
      OR lower(e."recurrence") LIKE '%annual%'
      OR lower(e."recurrence") LIKE '%birthday%'
      OR lower(e."recurrence") LIKE '%anniversar%' THEN 'yearly'
    WHEN lower(e."recurrence") LIKE '%month%' THEN 'monthly'
    WHEN lower(e."recurrence") LIKE '%week%' THEN 'weekly'
    WHEN lower(e."recurrence") LIKE '%dail%'
      OR lower(e."recurrence") LIKE '%every day%' THEN 'daily'
    ELSE NULL
  END,
  1,
  NULL,
  e."recurrence",
  -- Seeded from the anchor. The range endpoint recomputes and writes back any
  -- repeating moment whose next occurrence has moved on, so a birthday
  -- backfilled from 1990 corrects itself the first time it is read.
  e."starts_at",
  e."needs_reminder",
  e."reminder_reason",
  m."remind_at",
  m."trigger_id",
  m."created_at",
  m."updated_at"
FROM `entity_moments` m
JOIN `entities` e ON e."id" = m."entity_id";--> statement-breakpoint
DROP TABLE `entity_moments`;--> statement-breakpoint
ALTER TABLE `__new_entity_moments` RENAME TO `entity_moments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entity_moments_next_idx` ON `entity_moments` (`user_id`,`next_occurrence_at`);--> statement-breakpoint
CREATE INDEX `entity_moments_remind_idx` ON `entity_moments` (`user_id`,`remind_at`);
--> statement-breakpoint
-- Any time entity that never got a facet gets one now, so "is this a moment?"
-- is answered by one table instead of two.
INSERT OR IGNORE INTO `entity_moments` (
  "entity_id", "user_id", "kind", "precision",
  "starts_at", "ends_at", "all_day", "timezone",
  "recurrence_interval", "recurrence_text",
  "next_occurrence_at", "needs_reminder", "reminder_reason",
  "created_at", "updated_at"
)
SELECT
  e."id", e."user_id", COALESCE(e."time_kind", 'date'),
  CASE
    WHEN e."starts_at" IS NULL THEN 'unknown'
    WHEN e."all_day" = 1 THEN 'day'
    WHEN length(e."starts_at") <= 10 THEN 'day'
    ELSE 'minute'
  END,
  e."starts_at", e."ends_at", e."all_day", e."timezone",
  1, e."recurrence",
  e."starts_at", e."needs_reminder", e."reminder_reason",
  e."created_at", e."updated_at"
FROM `entities` e
WHERE e."type" = 'time';
