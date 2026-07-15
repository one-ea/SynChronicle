CREATE TYPE "public"."run_command_status" AS ENUM('pending', 'claimed', 'applied');--> statement-breakpoint
CREATE TABLE "run_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"instruction" text NOT NULL,
	"status" "run_command_status" DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"claimed_lease_version" integer,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD COLUMN "stable_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "lease_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "snapshot_id" text;--> statement-breakpoint
ALTER TABLE "run_commands" ADD CONSTRAINT "run_commands_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_commands_run_command_uq" ON "run_commands" USING btree ("run_id","command_id");--> statement-breakpoint
CREATE INDEX "run_commands_run_status_idx" ON "run_commands" USING btree ("run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_stable_id_uq" ON "run_events" USING btree ("run_id","stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_run_snapshot_uq" ON "usage_records" USING btree ("run_id","snapshot_id");