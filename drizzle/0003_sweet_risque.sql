CREATE TABLE "message_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
