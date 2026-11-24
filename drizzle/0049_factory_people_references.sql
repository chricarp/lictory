ALTER TABLE "agent" DROP CONSTRAINT "agent_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_created_by_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_session" DROP CONSTRAINT "agent_session_requested_by_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "runner" DROP CONSTRAINT "runner_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "runner" DROP CONSTRAINT "runner_created_by_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "runner_registration" DROP CONSTRAINT "runner_registration_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "runner_registration" DROP CONSTRAINT "runner_registration_created_by_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner" ADD CONSTRAINT "runner_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_registration" ADD CONSTRAINT "runner_registration_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;