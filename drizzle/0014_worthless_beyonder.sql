ALTER TYPE "public"."quota_operation" ADD VALUE 'estimate_settle' BEFORE 'release';--> statement-breakpoint
ALTER TYPE "public"."quota_reservation_status" ADD VALUE 'provider_completed' BEFORE 'settled';--> statement-breakpoint
ALTER TYPE "public"."quota_reservation_status" ADD VALUE 'needs_reconciliation' BEFORE 'settled';--> statement-breakpoint
ALTER TABLE "model_call_contexts" ADD COLUMN "invocation_key" text;--> statement-breakpoint
UPDATE "model_call_contexts" SET "invocation_key" = "scope" || ':' || "sequence"::text WHERE "invocation_key" IS NULL;--> statement-breakpoint
ALTER TABLE "model_call_contexts" ALTER COLUMN "invocation_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_reservations" ADD COLUMN "provider_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quota_settlement_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_call_contexts_task_invocation_uq" ON "model_call_contexts" USING btree ("task_id","invocation_key");
