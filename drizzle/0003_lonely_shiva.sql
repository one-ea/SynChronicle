ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_user_project_fk";
--> statement-breakpoint
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_user_project_fk";
--> statement-breakpoint
DROP INDEX "artifacts_project_type_version_uq";--> statement-breakpoint
DROP INDEX "artifacts_user_project_idx";--> statement-breakpoint
DROP INDEX "chapters_project_sequence_uq";--> statement-breakpoint
DROP INDEX "chapters_user_project_idx";--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "state" jsonb;--> statement-breakpoint
INSERT INTO "runs" ("id", "user_id", "project_id", "status")
SELECT gen_random_uuid(), scope."user_id", scope."project_id", 'paused'
FROM (
  SELECT "user_id", "project_id" FROM "artifacts"
  UNION
  SELECT "user_id", "project_id" FROM "chapters"
) scope
WHERE NOT EXISTS (
  SELECT 1 FROM "runs"
  WHERE "runs"."user_id" = scope."user_id" AND "runs"."project_id" = scope."project_id"
);--> statement-breakpoint
UPDATE "artifacts" SET "run_id" = (
  SELECT "runs"."id" FROM "runs"
  WHERE "runs"."user_id" = "artifacts"."user_id" AND "runs"."project_id" = "artifacts"."project_id"
  ORDER BY "runs"."created_at", "runs"."id" LIMIT 1
);--> statement-breakpoint
UPDATE "chapters" SET "run_id" = (
  SELECT "runs"."id" FROM "runs"
  WHERE "runs"."user_id" = "chapters"."user_id" AND "runs"."project_id" = "chapters"."project_id"
  ORDER BY "runs"."created_at", "runs"."id" LIMIT 1
);--> statement-breakpoint
ALTER TABLE "artifacts" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_project_run_fk" FOREIGN KEY ("user_id","project_id","run_id") REFERENCES "public"."runs"("user_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_scope_type_version_uq" ON "artifacts" USING btree ("user_id","project_id","run_id","type","version");--> statement-breakpoint
CREATE INDEX "artifacts_scope_idx" ON "artifacts" USING btree ("user_id","project_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_scope_sequence_version_uq" ON "chapters" USING btree ("user_id","project_id","run_id","sequence","version");--> statement-breakpoint
CREATE INDEX "chapters_scope_idx" ON "chapters" USING btree ("user_id","project_id","run_id");--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_sequence_positive_ck" CHECK ("chapters"."sequence" > 0);
