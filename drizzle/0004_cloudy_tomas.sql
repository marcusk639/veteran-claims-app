CREATE TABLE "cost_alert_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_alerted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "conversations_user_id_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_costs_created_at_idx" ON "message_costs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");