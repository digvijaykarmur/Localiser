-- drizzle migration: M0 schema

CREATE TABLE IF NOT EXISTS "titles" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "name_native" text NOT NULL,
  "dialect" text NOT NULL,
  "synopsis" text NOT NULL,
  "runtime_ms" integer NOT NULL,
  "spoiler_boundary_ms" integer NOT NULL,
  "genre" jsonb NOT NULL,
  "artwork_url" text,
  "deep_link" text NOT NULL,
  "fetched_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "scenes" (
  "id" text PRIMARY KEY,
  "title_id" text NOT NULL REFERENCES "titles"("id"),
  "start_ms" integer NOT NULL,
  "end_ms" integer NOT NULL,
  "frame_url" text,
  "has_dialogue" boolean NOT NULL,
  "raw" jsonb
);

CREATE TABLE IF NOT EXISTS "evidence_units" (
  "id" text PRIMARY KEY,
  "title_id" text NOT NULL REFERENCES "titles"("id"),
  "payload" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "angles" (
  "id" text PRIMARY KEY,
  "title_id" text NOT NULL REFERENCES "titles"("id"),
  "payload" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "recipes" (
  "id" text PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "promo_plans" (
  "recipe_id" text NOT NULL REFERENCES "recipes"("id"),
  "ratio" text NOT NULL,
  "payload" jsonb NOT NULL,
  PRIMARY KEY ("recipe_id", "ratio")
);

CREATE TABLE IF NOT EXISTS "scripts" (
  "recipe_id" text PRIMARY KEY REFERENCES "recipes"("id"),
  "payload" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "timelines" (
  "recipe_id" text NOT NULL REFERENCES "recipes"("id"),
  "ratio" text NOT NULL,
  "payload" jsonb NOT NULL,
  PRIMARY KEY ("recipe_id", "ratio")
);

CREATE TABLE IF NOT EXISTS "jobs" (
  "id" text PRIMARY KEY,
  "recipe_id" text NOT NULL REFERENCES "recipes"("id"),
  "status" text NOT NULL,
  "stage" text NOT NULL,
  "progress" integer NOT NULL,
  "cost_inr" double precision NOT NULL DEFAULT 0,
  "error" text,
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "artifacts" (
  "recipe_id" text NOT NULL,
  "stage" text NOT NULL,
  "ratio" text NOT NULL,
  "input_hash" text NOT NULL,
  "storage_key" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_idempotency" ON "artifacts" ("recipe_id","stage","ratio","input_hash");

CREATE TABLE IF NOT EXISTS "ledger" (
  "promo_id" text PRIMARY KEY,
  "recipe_id" text NOT NULL,
  "title_id" text NOT NULL,
  "format" text NOT NULL,
  "dialect" text NOT NULL,
  "ratio" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "payload" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "model_calls" (
  "call_id" text PRIMARY KEY,
  "stage" text NOT NULL,
  "recipe_id" text,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "input_hash" text NOT NULL,
  "tokens_in" integer NOT NULL,
  "tokens_out" integer NOT NULL,
  "cost_inr" double precision NOT NULL,
  "latency_ms" integer NOT NULL,
  "attempt" integer NOT NULL,
  "schema_ok" boolean NOT NULL,
  "raw_output" text,
  "created_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "outcomes" (
  "promo_id" text PRIMARY KEY,
  "impressions" integer NOT NULL,
  "view_3s" double precision NOT NULL,
  "views_complete" double precision NOT NULL,
  "clicks" integer NOT NULL,
  "synced_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_canary" (
  "provider" text PRIMARY KEY,
  "model" text,
  "last_ok_at" timestamptz,
  "last_error" text,
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS "golden_set" (
  "id" text PRIMARY KEY,
  "dialect" text NOT NULL,
  "promo_id" text NOT NULL,
  "hook" integer NOT NULL,
  "truth" integer NOT NULL,
  "craft" integer NOT NULL,
  "dialect_score" integer NOT NULL,
  "editor_overall" integer NOT NULL,
  "judge_a8" double precision
);
