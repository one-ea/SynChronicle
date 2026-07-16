DROP INDEX "model_call_contexts_task_scope_sequence_uq";--> statement-breakpoint
DROP INDEX "model_call_contexts_task_invocation_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "model_call_contexts_task_lease_scope_sequence_uq" ON "model_call_contexts" USING btree ("task_id","lease_version","scope","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "model_call_contexts_task_lease_invocation_uq" ON "model_call_contexts" USING btree ("task_id","lease_version","invocation_key");