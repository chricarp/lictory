CREATE TABLE `ask_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question` text NOT NULL,
	`answer_markdown` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ask_queries_user_created_idx` ON `ask_queries` (`user_id`,`created_at`);
