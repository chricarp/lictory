CREATE TABLE `ask_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ask_conversations_user_updated_idx` ON `ask_conversations` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `ask_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer NOT NULL,
	`content_markdown` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ask_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ask_messages_role_check" CHECK("ask_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ask_messages_conversation_position_idx` ON `ask_messages` (`conversation_id`,`position`);
--> statement-breakpoint
INSERT INTO `ask_conversations` (`id`, `user_id`, `title`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, substr(`question`, 1, 80), `created_at`, `created_at`
FROM `ask_queries`;
--> statement-breakpoint
INSERT INTO `ask_messages` (`id`, `conversation_id`, `role`, `position`, `content_markdown`, `citations_json`, `created_at`, `updated_at`)
SELECT `id` || ':user', `id`, 'user', 0, `question`, '[]', `created_at`, `created_at`
FROM `ask_queries`;
--> statement-breakpoint
INSERT INTO `ask_messages` (`id`, `conversation_id`, `role`, `position`, `content_markdown`, `citations_json`, `created_at`, `updated_at`)
SELECT `id` || ':assistant', `id`, 'assistant', 1, `answer_markdown`, `citations_json`, `created_at`, `created_at`
FROM `ask_queries`;
--> statement-breakpoint
DROP TABLE `ask_queries`;
