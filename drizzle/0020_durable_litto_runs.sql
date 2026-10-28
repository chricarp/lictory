CREATE TABLE "intelligence_chat_request" (
	"chat_id" text NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "intelligence_chat_request_chat_id_id_pk" PRIMARY KEY("chat_id","id")
);
--> statement-breakpoint
CREATE TABLE "intelligence_chat_run" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"status" text NOT NULL,
	"assistant_id" text NOT NULL,
	"request_id" text,
	"position" integer NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_until" timestamp,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_chat_run_status" CHECK ("intelligence_chat_run"."status" in ('queued', 'running', 'waiting', 'completed', 'canceled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "intelligence_chat_tool" (
	"run_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"name" text NOT NULL,
	"input" jsonb NOT NULL,
	"replayable" boolean NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"output" jsonb,
	CONSTRAINT "intelligence_chat_tool_run_id_tool_call_id_pk" PRIMARY KEY("run_id","tool_call_id")
);
--> statement-breakpoint
ALTER TABLE "intelligence_chat" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "intelligence_chat_request" ADD CONSTRAINT "intelligence_chat_request_chat_id_intelligence_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."intelligence_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_chat_run" ADD CONSTRAINT "intelligence_chat_run_chat_id_intelligence_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."intelligence_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_chat_tool" ADD CONSTRAINT "intelligence_chat_tool_run_id_intelligence_chat_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."intelligence_chat_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_chat_run_pending_idx" ON "intelligence_chat_run" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "intelligence_chat_run_chat_idx" ON "intelligence_chat_run" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_chat_run_active_idx" ON "intelligence_chat_run" USING btree ("chat_id") WHERE "intelligence_chat_run"."status" in ('queued', 'running', 'waiting');