CREATE TABLE "intelligence_chat" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_chat_message" (
	"id" text NOT NULL,
	"chat_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_chat_message_chat_id_id_pk" PRIMARY KEY("chat_id","id"),
	CONSTRAINT "intelligence_chat_message_role" CHECK ("intelligence_chat_message"."role" in ('user', 'assistant', 'system'))
);
--> statement-breakpoint
ALTER TABLE "intelligence_chat" ADD CONSTRAINT "intelligence_chat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_chat" ADD CONSTRAINT "intelligence_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_chat_message" ADD CONSTRAINT "intelligence_chat_message_chat_id_intelligence_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."intelligence_chat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_chat_owner_idx" ON "intelligence_chat" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_chat_message_position_idx" ON "intelligence_chat_message" USING btree ("chat_id","position");