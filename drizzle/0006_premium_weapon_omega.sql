CREATE TABLE "founding_supporters" (
	"user_id" text PRIMARY KEY NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
