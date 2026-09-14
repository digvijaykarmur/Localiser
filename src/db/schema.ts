import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const titles = pgTable("titles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameNative: text("name_native").notNull(),
  dialect: text("dialect").notNull(),
  synopsis: text("synopsis").notNull(),
  runtimeMs: integer("runtime_ms").notNull(),
  spoilerBoundaryMs: integer("spoiler_boundary_ms").notNull(),
  genre: jsonb("genre").$type<string[]>().notNull(),
  artworkUrl: text("artwork_url"),
  deepLink: text("deep_link").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const scenes = pgTable("scenes", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => titles.id),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  frameUrl: text("frame_url"),
  hasDialogue: boolean("has_dialogue").notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
});

export const evidenceUnits = pgTable("evidence_units", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => titles.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const angles = pgTable("angles", {
  id: text("id").primaryKey(),
  titleId: text("title_id").notNull().references(() => titles.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const promoPlans = pgTable(
  "promo_plans",
  {
    recipeId: text("recipe_id").notNull().references(() => recipes.id),
    ratio: text("ratio").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.recipeId, t.ratio] }),
  }),
);

export const scripts = pgTable("scripts", {
  recipeId: text("recipe_id").primaryKey().references(() => recipes.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const timelines = pgTable(
  "timelines",
  {
    recipeId: text("recipe_id").notNull().references(() => recipes.id),
    ratio: text("ratio").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.recipeId, t.ratio] }),
  }),
);

export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  recipeId: text("recipe_id").notNull().references(() => recipes.id),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  progress: integer("progress").notNull(),
  costInr: doublePrecision("cost_inr").notNull().default(0),
  error: text("error"),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const artifacts = pgTable(
  "artifacts",
  {
    recipeId: text("recipe_id").notNull(),
    stage: text("stage").notNull(),
    ratio: text("ratio").notNull(),
    inputHash: text("input_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("artifacts_idempotency").on(
      t.recipeId,
      t.stage,
      t.ratio,
      t.inputHash,
    ),
  }),
);

export const ledger = pgTable("ledger", {
  promoId: text("promo_id").primaryKey(),
  recipeId: text("recipe_id").notNull(),
  titleId: text("title_id").notNull(),
  format: text("format").notNull(),
  dialect: text("dialect").notNull(),
  ratio: text("ratio").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

export const modelCalls = pgTable("model_calls", {
  callId: text("call_id").primaryKey(),
  stage: text("stage").notNull(),
  recipeId: text("recipe_id"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputHash: text("input_hash").notNull(),
  tokensIn: integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costInr: doublePrecision("cost_inr").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  attempt: integer("attempt").notNull(),
  schemaOk: boolean("schema_ok").notNull(),
  rawOutput: text("raw_output"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const outcomes = pgTable("outcomes", {
  promoId: text("promo_id").primaryKey(),
  impressions: integer("impressions").notNull(),
  view3s: doublePrecision("view_3s").notNull(),
  viewsComplete: doublePrecision("views_complete").notNull(),
  clicks: integer("clicks").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
});

export const providerCanary = pgTable("provider_canary", {
  provider: text("provider").primaryKey(),
  model: text("model"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const goldenSet = pgTable("golden_set", {
  id: text("id").primaryKey(),
  dialect: text("dialect").notNull(),
  promoId: text("promo_id").notNull(),
  hook: integer("hook").notNull(),
  truth: integer("truth").notNull(),
  craft: integer("craft").notNull(),
  dialectScore: integer("dialect_score").notNull(),
  editorOverall: integer("editor_overall").notNull(),
  judgeA8: doublePrecision("judge_a8"),
});
