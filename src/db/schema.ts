import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SubjectBox } from "@/domain/evidence";

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
  intelligenceBuiltAt: timestamp("intelligence_built_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  masterStorageKey: text("master_storage_key"),
  sceneCount: integer("scene_count"),
});

export const scenes = pgTable(
  "scenes",
  {
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id),
    seq: integer("seq").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    frameKeys: jsonb("frame_keys").$type<string[]>(),
  },
  (t) => ({ pk: uniqueIndex("scenes_pk").on(t.titleId, t.seq) }),
);

export const evidenceUnits = pgTable(
  "evidence_units",
  {
    id: text("id").primaryKey(),
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    frameUrls: jsonb("frame_urls").$type<string[]>().notNull(),
    description: text("description").notNull(),
    shotType: text("shot_type").notNull(),
    subjectCount: integer("subject_count").notNull(),
    subjectBoxes: jsonb("subject_boxes").$type<SubjectBox[]>().notNull(),
    motion: text("motion").notNull(),
    emotion: jsonb("emotion").$type<string[]>().notNull(),
    intensity: integer("intensity").notNull(),
    hasDialogue: boolean("has_dialogue").notNull(),
    dialogueNative: text("dialogue_native"),
    isSpoiler: boolean("is_spoiler").notNull(),
    usable: boolean("usable").notNull(),
    unusableReason: text("unusable_reason"),
    croppable11: boolean("croppable_11").notNull(),
    croppable916: boolean("croppable_916").notNull(),
    cropNote: text("crop_note"),
  },
  (t) => ({
    byTitle: index("ev_by_title").on(t.titleId),
    byShot: index("ev_by_shot").on(t.titleId, t.shotType),
  }),
);

export const angles = pgTable(
  "angles",
  {
    id: text("id").primaryKey(),
    titleId: text("title_id")
      .notNull()
      .references(() => titles.id),
    kind: text("kind").notNull(),
    claim: text("claim").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    hookCandidateIds: jsonb("hook_candidate_ids").$type<string[]>().notNull(),
    audienceNote: text("audience_note").notNull(),
    spoilerSafe: boolean("spoiler_safe").notNull(),
    verticalFeasible: boolean("vertical_feasible").notNull(),
    promptVersion: text("prompt_version").notNull(),
  },
  (t) => ({ byTitle: index("angles_by_title").on(t.titleId) }),
);

/** Immutable. A trigger raises on UPDATE (see migration). */
export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  createdBy: text("created_by").notNull(),
  titleId: text("title_id")
    .notNull()
    .references(() => titles.id),
  angleId: text("angle_id").notNull(),
  format: text("format").notNull(),
  dialect: text("dialect").notNull(),
  durationS: integer("duration_s").notNull(),
  ratios: jsonb("ratios").$type<string[]>().notNull(),
  sourceWindow: jsonb("source_window").$type<{ start_ms: number; end_ms: number } | null>(),
  personaId: text("persona_id"),
  musicBrief: text("music_brief"),
  ctaVariant: text("cta_variant").notNull(),
  costEnvelopeInr: real("cost_envelope_inr").notNull(),
  dialectPackVersion: text("dialect_pack_version").notNull(),
  promptVersions: jsonb("prompt_versions").$type<Record<string, string>>().notNull(),
  seed: integer("seed").notNull(),
});

export const presets = pgTable("presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").notNull(),
  dialect: text("dialect").notNull(),
  durationS: integer("duration_s").notNull(),
  ratios: jsonb("ratios").$type<string[]>().notNull(),
  ctaVariant: text("cta_variant").notNull(),
  musicBrief: text("music_brief"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    stage: text("stage").notNull(),
    /** stage that is actually executing while stage === WAITING_PROVIDER */
    resumeStage: text("resume_stage"),
    error: jsonb("error").$type<Record<string, unknown> | null>(),
    costSpentInr: numeric("cost_spent_inr").notNull().default("0"),
    costBreakdown: jsonb("cost_breakdown").$type<Record<string, number>>().notNull().default({}),
    stageTimings: jsonb("stage_timings").$type<Record<string, { started_at: string; finished_at?: string }>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    promoId: text("promo_id"),
  },
  (t) => ({ byRecipe: index("jobs_by_recipe").on(t.recipeId), byStage: index("jobs_by_stage").on(t.stage) }),
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    stage: text("stage").notNull(),
    ratio: text("ratio"),
    kind: text("kind").notNull(), // plan | script | timeline | render | qc | raw_model_output
    payload: jsonb("payload").$type<unknown>(),
    storageKey: text("storage_key"),
    inputHash: text("input_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idem: uniqueIndex("artifact_idem").on(t.jobId, t.stage, t.ratio, t.inputHash), byJob: index("artifacts_by_job").on(t.jobId) }),
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    kind: text("kind").notNull(), // source_cut | vo | music | caption_card | cta_card | cta_bg | presenter | still
    ratio: text("ratio"),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    provenance: jsonb("provenance").$type<AssetProvenance>().notNull(),
    inputHash: text("input_hash").notNull(),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ idem: uniqueIndex("asset_idem").on(t.jobId, t.kind, t.ratio, t.inputHash), byJob: index("assets_by_job").on(t.jobId) }),
);

export interface AssetProvenance {
  provider: string; // ffmpeg | sharp | elevenlabs | vertex | snapshot
  model: string | null;
  prompt_version: string | null;
  input_hash: string;
  source_title_id?: string;
  source_in_ms?: number;
  source_out_ms?: number;
}

export const promos = pgTable(
  "promos",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    recipeId: text("recipe_id").notNull(),
    titleId: text("title_id").notNull(),
    status: text("status").notNull(),
    verdict: text("verdict"),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default([]),
    editMinutes: real("edit_minutes"),
    note: text("note"),
    reviewer: text("reviewer"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    channel: text("channel"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    exportKeys: jsonb("export_keys").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byStatus: index("promos_by_status").on(t.status), byJob: index("promos_by_job").on(t.jobId) }),
);

export const ledger = pgTable(
  "ledger",
  {
    promoId: text("promo_id").notNull(),
    ratio: text("ratio").notNull(),
    recipeId: text("recipe_id").notNull(),
    titleId: text("title_id").notNull(),
    format: text("format").notNull(),
    dialect: text("dialect").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    costInr: real("cost_inr").notNull(),
    costBreakdown: jsonb("cost_breakdown").$type<Record<string, number>>().notNull(),
    wallMs: integer("wall_ms").notNull(),

    qcDeterministic: jsonb("qc_deterministic").$type<Record<string, boolean>>().notNull(),
    qcAi: jsonb("qc_ai").$type<Record<string, number | boolean>>().notNull(),

    editorVerdict: text("editor_verdict"),
    editorReasonCodes: jsonb("editor_reason_codes").$type<string[]>().notNull().default([]),
    editorEditMinutes: real("editor_edit_minutes"),
    editorNote: text("editor_note"),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    impressions: integer("impressions"),
    viewRate3s: real("view_rate_3s"),
    completionRate: real("completion_rate"),
    ctrToTitle: real("ctr_to_title"),
  },
  (t) => ({
    pk: uniqueIndex("ledger_pk").on(t.promoId, t.ratio),
    byPair: index("ledger_by_pair").on(t.format, t.dialect),
  }),
);

export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  weekStart: text("week_start").notNull(),
  budgetInr: real("budget_inr").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slots = pgTable(
  "slots",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    date: text("date").notNull(),
    intendedFormat: text("intended_format").notNull(),
    titleId: text("title_id"),
    recipeId: text("recipe_id"),
    jobId: text("job_id"),
    promoId: text("promo_id"),
    status: text("status").notNull().default("EMPTY"),
  },
  (t) => ({ byCampaign: index("slots_by_campaign").on(t.campaignId) }),
);

export const dialectVersions = pgTable(
  "dialect_versions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    version: text("version").notNull(),
    pack: jsonb("pack").$type<unknown>().notNull(),
    savedBy: text("saved_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex("dialect_version_uniq").on(t.code, t.version) }),
);

export const modelCalls = pgTable(
  "model_calls",
  {
    callId: text("call_id").primaryKey(),
    stage: text("stage").notNull(),
    recipeId: text("recipe_id"),
    titleId: text("title_id"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costInr: real("cost_inr").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    attempt: integer("attempt").notNull(),
    schemaOk: boolean("schema_ok").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byRecipe: index("model_calls_by_recipe").on(t.recipeId) }),
);

export const pppTiers = pgTable(
  "ppp_tiers",
  {
    format: text("format").notNull(),
    dialect: text("dialect").notNull(),
    tier: text("tier").notNull(),
    promos: integer("promos").notNull(),
    approvalRate: real("approval_rate").notNull(),
    medianEditMinutes: real("median_edit_minutes"),
    recentR01R02: integer("recent_r01_r02").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: uniqueIndex("ppp_pk").on(t.format, t.dialect) }),
);

/** Human ratings of the golden set (§31.4). */
export const goldenRatings = pgTable(
  "golden_ratings",
  {
    promoId: text("promo_id").notNull(),
    rater: text("rater").notNull(),
    hook: integer("hook").notNull(),
    truth: integer("truth").notNull(),
    craft: integer("craft").notNull(),
    dialect: integer("dialect").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: uniqueIndex("golden_pk").on(t.promoId, t.rater) }),
);
