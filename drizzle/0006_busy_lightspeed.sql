UPDATE "usage_records" SET "snapshot_id" = "id"::text WHERE "snapshot_id" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_records" ALTER COLUMN "snapshot_id" SET NOT NULL;
