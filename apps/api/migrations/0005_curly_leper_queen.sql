CREATE TABLE `entity_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`alias_key` text NOT NULL,
	`entity_id` text NOT NULL,
	`source` text DEFAULT 'derived' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_aliases_source_check" CHECK("entity_aliases"."source" in ('canonical', 'observed', 'derived', 'user'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_aliases_lookup_idx` ON `entity_aliases` (`user_id`,`type`,`alias_key`);--> statement-breakpoint
CREATE INDEX `entity_aliases_entity_idx` ON `entity_aliases` (`entity_id`);--> statement-breakpoint
CREATE TABLE `entity_duplicates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`candidate_entity_id` text NOT NULL,
	`score` real NOT NULL,
	`reason` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_duplicates_status_check" CHECK("entity_duplicates"."status" in ('open', 'dismissed', 'merged')),
	CONSTRAINT "entity_duplicates_distinct_check" CHECK("entity_duplicates"."entity_id" <> "entity_duplicates"."candidate_entity_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_duplicates_pair_idx` ON `entity_duplicates` (`entity_id`,`candidate_entity_id`);--> statement-breakpoint
CREATE INDEX `entity_duplicates_user_idx` ON `entity_duplicates` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `entity_moments` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'date' NOT NULL,
	`precision` text DEFAULT 'unknown' NOT NULL,
	`remind_at` text,
	`trigger_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_moments_kind_check" CHECK("entity_moments"."kind" in ('date', 'event', 'deadline', 'reminder')),
	CONSTRAINT "entity_moments_precision_check" CHECK("entity_moments"."precision" in ('minute', 'day', 'month', 'year', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `entity_moments_remind_idx` ON `entity_moments` (`user_id`,`remind_at`);--> statement-breakpoint
CREATE TABLE `entity_places` (
	`entity_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`formatted_address` text,
	`street` text,
	`locality` text,
	`region` text,
	`postal_code` text,
	`country` text,
	`latitude` real,
	`longitude` real,
	`geohash` text,
	`precision` text DEFAULT 'unknown' NOT NULL,
	`source` text DEFAULT 'model' NOT NULL,
	`parent_entity_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_places_precision_check" CHECK("entity_places"."precision" in ('exact', 'street', 'locality', 'region', 'country', 'unknown')),
	CONSTRAINT "entity_places_source_check" CHECK("entity_places"."source" in ('model', 'inherited', 'geocoder', 'user'))
);
--> statement-breakpoint
CREATE INDEX `entity_places_geohash_idx` ON `entity_places` (`user_id`,`geohash`);--> statement-breakpoint
CREATE INDEX `entity_places_locality_idx` ON `entity_places` (`user_id`,`locality`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`scheduled_for` text,
	`timezone` text,
	`location_label` text,
	`latitude` real,
	`longitude` real,
	`radius_meters` integer,
	`location_event` text,
	`origin` text DEFAULT 'user' NOT NULL,
	`note_id` text,
	`entity_id` text,
	`created_at` text NOT NULL,
	`triggered_at` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "triggers_type_check" CHECK("__new_triggers"."type" in ('time', 'location')),
	CONSTRAINT "triggers_origin_check" CHECK("__new_triggers"."origin" in ('ai', 'user')),
	CONSTRAINT "triggers_status_check" CHECK("__new_triggers"."status" in ('active', 'triggered', 'cancelled')),
	CONSTRAINT "triggers_location_event_check" CHECK("__new_triggers"."location_event" is null or "__new_triggers"."location_event" in ('enter', 'exit'))
);
--> statement-breakpoint
INSERT INTO `__new_triggers`("id", "user_id", "type", "status", "title", "body", "scheduled_for", "timezone", "location_label", "latitude", "longitude", "radius_meters", "location_event", "note_id", "entity_id", "created_at", "triggered_at") SELECT "id", "user_id", "type", "status", "title", "body", "scheduled_for", "timezone", "location_label", "latitude", "longitude", "radius_meters", "location_event", "note_id", "entity_id", "created_at", "triggered_at" FROM `triggers`;--> statement-breakpoint
DROP TABLE `triggers`;--> statement-breakpoint
ALTER TABLE `__new_triggers` RENAME TO `triggers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `triggers_user_status_idx` ON `triggers` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `triggers_scheduled_idx` ON `triggers` (`scheduled_for`,`status`);--> statement-breakpoint
CREATE INDEX `triggers_note_idx` ON `triggers` (`note_id`);--> statement-breakpoint
CREATE INDEX `triggers_entity_idx` ON `triggers` (`entity_id`);--> statement-breakpoint
-- Backfill: every existing entity keeps its identity key as a canonical alias,
-- so resolution is a lookup from the first request rather than only for nodes
-- the pipeline happens to touch again. Richer aliases (acronyms, middle-name
-- free forms) are added lazily as each entity is next resolved.
INSERT OR IGNORE INTO `entity_aliases` (`id`, `user_id`, `type`, `alias_key`, `entity_id`, `source`, `created_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
       `user_id`, `type`, `normalized_key`, `id`, 'canonical', `created_at`
  FROM `entities`
 WHERE `normalized_key` <> '';
--> statement-breakpoint
-- Backfill: promote the place columns already on `entities` into the dedicated
-- table. `geohash` stays null until the place is next resolved, because it
-- cannot be computed in SQL.
INSERT OR IGNORE INTO `entity_places` (`entity_id`, `user_id`, `formatted_address`, `latitude`, `longitude`, `precision`, `source`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `address`, `latitude`, `longitude`,
       CASE WHEN `latitude` IS NOT NULL THEN 'exact' ELSE 'unknown' END,
       CASE WHEN `origin` = 'user' THEN 'user' ELSE 'model' END,
       `created_at`, `updated_at`
  FROM `entities`
 WHERE `type` = 'place';
--> statement-breakpoint
-- Backfill: promote the time columns already on `entities` into the dedicated
-- table. `remind_at` stays null so no historical note retroactively schedules a
-- notification the user never saw coming.
INSERT OR IGNORE INTO `entity_moments` (`entity_id`, `user_id`, `kind`, `precision`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, COALESCE(`time_kind`, 'date'),
       CASE
         WHEN `starts_at` IS NULL THEN 'unknown'
         WHEN `all_day` = 1 THEN 'day'
         WHEN length(`starts_at`) <= 10 THEN 'day'
         ELSE 'minute'
       END,
       `created_at`, `updated_at`
  FROM `entities`
 WHERE `type` = 'time';
