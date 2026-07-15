CREATE TABLE "user_model_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_set_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"agents" jsonb NOT NULL,
	"active" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_model_sets" ADD CONSTRAINT "user_model_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_model_sets_user_set_version_uq" ON "user_model_sets" USING btree ("user_id","model_set_id","version");--> statement-breakpoint
CREATE INDEX "user_model_sets_user_active_idx" ON "user_model_sets" USING btree ("user_id","active");