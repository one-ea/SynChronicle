ALTER TYPE "public"."credential_status" ADD VALUE 'disabled' BEFORE 'revoked';--> statement-breakpoint
DROP INDEX "provider_credentials_user_provider_uq";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "label" text DEFAULT 'Provider credential' NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_credentials_user_provider_idx" ON "provider_credentials" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "user_model_sets_user_active_uq" ON "user_model_sets" USING btree ("user_id") WHERE "user_model_sets"."active" = 1;