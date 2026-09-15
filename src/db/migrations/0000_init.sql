CREATE TABLE IF NOT EXISTS "angles" (
	"id" text PRIMARY KEY NOT NULL,
	"title_id" text NOT NULL,
	"kind" text NOT NULL,
	"claim" text NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"hook_candidate_ids" jsonb NOT NULL,
	"audience_note" text NOT NULL,
	"spoiler_safe" boolean NOT NULL,
	"vertical_feasible" boolean NOT NULL,
	"prompt_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"stage" text NOT NULL,
	"ratio" text,
	"kind" text NOT NULL,
	"payload" jsonb,
	"storage_key" text,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"ratio" text,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"provenance" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"week_start" text NOT NULL,
	"budget_inr" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dialect_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"version" text NOT NULL,
	"pack" jsonb NOT NULL,
	"saved_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_units" (
	"id" text PRIMARY KEY NOT NULL,
	"title_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"frame_urls" jsonb NOT NULL,
	"description" text NOT NULL,
	"shot_type" text NOT NULL,
	"subject_count" integer NOT NULL,
	"subject_boxes" jsonb NOT NULL,
	"motion" text NOT NULL,
	"emotion" jsonb NOT NULL,
	"intensity" integer NOT NULL,
	"has_dialogue" boolean NOT NULL,
	"dialogue_native" text,
	"is_spoiler" boolean NOT NULL,
	"usable" boolean NOT NULL,
	"unusable_reason" text,
	"croppable_11" boolean NOT NULL,
	"croppable_916" boolean NOT NULL,
	"crop_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golden_ratings" (
	"promo_id" text NOT NULL,
	"rater" text NOT NULL,
	"hook" integer NOT NULL,
	"truth" integer NOT NULL,
	"craft" integer NOT NULL,
	"dialect" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text NOT NULL,
	"stage" text NOT NULL,
	"resume_stage" text,
	"error" jsonb,
	"cost_spent_inr" numeric DEFAULT '0' NOT NULL,
	"cost_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage_timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"promo_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger" (
	"promo_id" text NOT NULL,
	"ratio" text NOT NULL,
	"recipe_id" text NOT NULL,
	"title_id" text NOT NULL,
	"format" text NOT NULL,
	"dialect" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cost_inr" real NOT NULL,
	"cost_breakdown" jsonb NOT NULL,
	"wall_ms" integer NOT NULL,
	"qc_deterministic" jsonb NOT NULL,
	"qc_ai" jsonb NOT NULL,
	"editor_verdict" text,
	"editor_reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"editor_edit_minutes" real,
	"editor_note" text,
	"published_at" timestamp with time zone,
	"impressions" integer,
	"view_rate_3s" real,
	"completion_rate" real,
	"ctr_to_title" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_calls" (
	"call_id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"recipe_id" text,
	"title_id" text,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_inr" real NOT NULL,
	"latency_ms" integer NOT NULL,
	"attempt" integer NOT NULL,
	"schema_ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ppp_tiers" (
	"format" text NOT NULL,
	"dialect" text NOT NULL,
	"tier" text NOT NULL,
	"promos" integer NOT NULL,
	"approval_rate" real NOT NULL,
	"median_edit_minutes" real,
	"recent_r01_r02" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"dialect" text NOT NULL,
	"duration_s" integer NOT NULL,
	"ratios" jsonb NOT NULL,
	"cta_variant" text NOT NULL,
	"music_brief" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promos" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"title_id" text NOT NULL,
	"status" text NOT NULL,
	"verdict" text,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edit_minutes" real,
	"note" text,
	"reviewer" text,
	"reviewed_at" timestamp with time zone,
	"channel" text,
	"scheduled_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"export_keys" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"title_id" text NOT NULL,
	"angle_id" text NOT NULL,
	"format" text NOT NULL,
	"dialect" text NOT NULL,
	"duration_s" integer NOT NULL,
	"ratios" jsonb NOT NULL,
	"source_window" jsonb,
	"persona_id" text,
	"music_brief" text,
	"cta_variant" text NOT NULL,
	"cost_envelope_inr" real NOT NULL,
	"dialect_pack_version" text NOT NULL,
	"prompt_versions" jsonb NOT NULL,
	"seed" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scenes" (
	"title_id" text NOT NULL,
	"seq" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"frame_keys" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slots" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"date" text NOT NULL,
	"intended_format" text NOT NULL,
	"title_id" text,
	"recipe_id" text,
	"job_id" text,
	"promo_id" text,
	"status" text DEFAULT 'EMPTY' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "titles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_native" text NOT NULL,
	"dialect" text NOT NULL,
	"synopsis" text NOT NULL,
	"runtime_ms" integer NOT NULL,
	"spoiler_boundary_ms" integer NOT NULL,
	"genre" jsonb NOT NULL,
	"artwork_url" text,
	"deep_link" text NOT NULL,
	"intelligence_built_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"master_storage_key" text,
	"scene_count" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "angles" ADD CONSTRAINT "angles_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evidence_units" ADD CONSTRAINT "evidence_units_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "promos" ADD CONSTRAINT "promos_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recipes" ADD CONSTRAINT "recipes_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scenes" ADD CONSTRAINT "scenes_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "slots" ADD CONSTRAINT "slots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "angles_by_title" ON "angles" USING btree ("title_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_idem" ON "artifacts" USING btree ("job_id","stage","ratio","input_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_by_job" ON "artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_idem" ON "assets" USING btree ("job_id","kind","ratio","input_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assets_by_job" ON "assets" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dialect_version_uniq" ON "dialect_versions" USING btree ("code","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ev_by_title" ON "evidence_units" USING btree ("title_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ev_by_shot" ON "evidence_units" USING btree ("title_id","shot_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "golden_pk" ON "golden_ratings" USING btree ("promo_id","rater");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_by_recipe" ON "jobs" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_by_stage" ON "jobs" USING btree ("stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_pk" ON "ledger" USING btree ("promo_id","ratio");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_by_pair" ON "ledger" USING btree ("format","dialect");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_calls_by_recipe" ON "model_calls" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ppp_pk" ON "ppp_tiers" USING btree ("format","dialect");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promos_by_status" ON "promos" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promos_by_job" ON "promos" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scenes_pk" ON "scenes" USING btree ("title_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slots_by_campaign" ON "slots" USING btree ("campaign_id");
--> statement-breakpoint
-- §16: recipes are immutable. An UPDATE is a defect, not an edit; raise loudly.
CREATE OR REPLACE FUNCTION recipes_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'recipes are immutable (recipe %). Create a new recipe instead.', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER recipes_no_update
  BEFORE UPDATE ON "recipes"
  FOR EACH ROW EXECUTE FUNCTION recipes_are_immutable();
