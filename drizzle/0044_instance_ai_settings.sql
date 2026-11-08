CREATE TABLE "instance_ai_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_ai_setting_single" CHECK ("instance_ai_setting"."id" = 'instance')
);
