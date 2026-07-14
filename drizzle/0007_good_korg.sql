CREATE TYPE "public"."agent_type" AS ENUM('knowledge-assistant');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "agent_type" SET DATA TYPE "public"."agent_type" USING "agent_type"::"public"."agent_type";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "role" SET DATA TYPE "public"."message_role" USING "role"::"public"."message_role";