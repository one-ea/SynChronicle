CREATE TYPE "public"."quota_outbox_action" AS ENUM('settle', 'release');--> statement-breakpoint
CREATE TYPE "public"."quota_outbox_status" AS ENUM('pending', 'processed');--> statement-breakpoint
CREATE TYPE "public"."quota_reservation_status" AS ENUM('reserved', 'settled', 'released');--> statement-breakpoint
CREATE TABLE "model_call_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"lease_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"model_call_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"lease_version" integer NOT NULL,
	"status" "quota_reservation_status" DEFAULT 'reserved' NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_settlement_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"action" "quota_outbox_action" NOT NULL,
	"status" "quota_outbox_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "model_call_contexts" ADD CONSTRAINT "model_call_contexts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_call_contexts" ADD CONSTRAINT "model_call_contexts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_id_quota_ledger_id_fk" FOREIGN KEY ("id") REFERENCES "public"."quota_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_model_call_id_model_call_contexts_id_fk" FOREIGN KEY ("model_call_id") REFERENCES "public"."model_call_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD CONSTRAINT "quota_reservations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_settlement_outbox" ADD CONSTRAINT "quota_settlement_outbox_reservation_id_quota_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."quota_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_call_contexts_task_sequence_uq" ON "model_call_contexts" USING btree ("task_id","sequence");--> statement-breakpoint
CREATE INDEX "quota_reservations_reconcile_idx" ON "quota_reservations" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_settlement_outbox_reservation_action_uq" ON "quota_settlement_outbox" USING btree ("reservation_id","action");--> statement-breakpoint
CREATE INDEX "quota_settlement_outbox_pending_idx" ON "quota_settlement_outbox" USING btree ("status","created_at");