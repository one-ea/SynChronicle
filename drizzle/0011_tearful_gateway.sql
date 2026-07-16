CREATE TYPE "public"."quota_operation" AS ENUM('credit', 'reserve', 'settle', 'release');--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"concurrency_limit" integer DEFAULT 4 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "budget_usd" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "model_call_id" text;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "operation" "quota_operation" DEFAULT 'credit' NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "idempotency_key" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "quota_ledger" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quota_ledger_idempotency_uq" ON "quota_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "quota_ledger_reservation_idx" ON "quota_ledger" USING btree ("reservation_id");