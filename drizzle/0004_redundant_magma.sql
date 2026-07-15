ALTER TABLE "runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_start_idempotency_uq" ON "runs" USING btree ("user_id","project_id","idempotency_key");