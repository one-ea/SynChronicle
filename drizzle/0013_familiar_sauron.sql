DROP INDEX "model_call_contexts_task_sequence_uq";--> statement-breakpoint
ALTER TABLE "model_call_contexts" ADD COLUMN "scope" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "model_call_contexts_task_scope_sequence_uq" ON "model_call_contexts" USING btree ("task_id","scope","sequence");