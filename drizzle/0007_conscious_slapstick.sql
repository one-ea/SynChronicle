ALTER TYPE "public"."run_command_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "run_commands" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_commands" ADD COLUMN "retryable" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_commands" ADD COLUMN "failure_category" text;--> statement-breakpoint
ALTER TABLE "run_commands" ADD COLUMN "error_message" text;