ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "quota_ledger" DROP CONSTRAINT "quota_ledger_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP CONSTRAINT "checkpoints_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP CONSTRAINT "checkpoints_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP CONSTRAINT "checkpoints_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "stream_chunks" DROP CONSTRAINT "stream_chunks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "stream_chunks" DROP CONSTRAINT "stream_chunks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "stream_chunks" DROP CONSTRAINT "stream_chunks_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "quota_ledger" SET "project_id" = "runs"."project_id" FROM "runs" WHERE "quota_ledger"."run_id" = "runs"."id";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_project_id_uq" UNIQUE("user_id","project_id","id");--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_user_project_run_id_uq" UNIQUE("user_id","project_id","run_id","id");--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_user_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_project_fk" FOREIGN KEY ("user_id","project_id") REFERENCES "public"."projects"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_latest_checkpoint_fk" FOREIGN KEY ("user_id","project_id","id","latest_checkpoint_id") REFERENCES "public"."checkpoints"("user_id","project_id","run_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_chunks" ADD CONSTRAINT "stream_chunks_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD CONSTRAINT "quota_ledger_run_requires_project_ck" CHECK ("quota_ledger"."run_id" is null or "quota_ledger"."project_id" is not null);
