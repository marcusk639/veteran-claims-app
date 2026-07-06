CREATE TABLE "usage_counters" (
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_user_id_feature_period_start_pk" PRIMARY KEY("user_id","feature","period_start")
);
