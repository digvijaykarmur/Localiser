import { z } from "zod";
import { DialectCode, PipelineStage, Ratio } from "./codes";
import { ReasonCode, EditorVerdict } from "./ledger";

export const JobStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const PromoJob = z.object({
  id: z.string(),
  recipe_id: z.string(),
  status: JobStatus,
  stage: PipelineStage,
  progress: z.number().min(0).max(100),
  cost_inr: z.number(),
  error: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type PromoJob = z.infer<typeof PromoJob>;

export const ReviewRequest = z.object({
  verdict: EditorVerdict,
  reason_codes: z.array(ReasonCode),
  edit_minutes: z.number().nonnegative(),
  note: z.string().optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const OutcomeRow = z.object({
  promo_id: z.string(),
  impressions: z.number().int(),
  view_3s: z.number(),
  views_complete: z.number(),
  clicks: z.number().int(),
  published_at: z.string().datetime().optional(),
});
export type OutcomeRow = z.infer<typeof OutcomeRow>;

export const PppTier = z.enum(["PROVE", "PILOT", "PRODUCTION"]);
export type PppTier = z.infer<typeof PppTier>;

export const MetricsPair = z.object({
  format: z.string(),
  dialect: DialectCode,
  produced: z.number().int(),
  approval_rate: z.number().nullable(),
  median_edit_minutes: z.number().nullable(),
  median_cost_approved_inr: z.number().nullable(),
  reason_histogram: z.array(z.object({ code: z.string(), count: z.number() })),
  judge_editor_spearman: z.number().nullable(),
  ppp_tier: PppTier,
});
export type MetricsPair = z.infer<typeof MetricsPair>;

export const ProviderCanary = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  last_ok_at: z.string().datetime().nullable(),
  last_error: z.string().nullable(),
});
export type ProviderCanary = z.infer<typeof ProviderCanary>;

export const MetricsSummary = z.object({
  pairs: z.array(MetricsPair),
  providers: z.array(ProviderCanary),
});
export type MetricsSummary = z.infer<typeof MetricsSummary>;

export const ModelCallLog = z.object({
  call_id: z.string(),
  stage: z.string(),
  recipe_id: z.string().nullable(),
  model: z.string(),
  prompt_version: z.string(),
  input_hash: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_inr: z.number(),
  latency_ms: z.number().int(),
  attempt: z.number().int(),
  schema_ok: z.boolean(),
});
export type ModelCallLog = z.infer<typeof ModelCallLog>;

export const QcCheck = z.object({
  id: z.string(),
  pass: z.boolean(),
  detail: z.string(),
});
export type QcCheck = z.infer<typeof QcCheck>;

export const DeterministicQcResult = z.object({
  pass: z.boolean(),
  checks: z.array(QcCheck),
});
export type DeterministicQcResult = z.infer<typeof DeterministicQcResult>;

export const AiJudgeResult = z.object({
  A1_subject_integrity: z.boolean(),
  A2_claim_truth: z.boolean(),
  A3_spoiler: z.boolean(),
  A4_text_legibility: z.boolean(),
  A5_dialect_match: z.number().min(0).max(1),
  A6_hook_strength: z.number().min(1).max(10),
  A7_pacing: z.number().min(1).max(10),
  A8_overall_craft: z.number().min(1).max(10),
  gate_pass: z.boolean(),
  notes: z.record(z.string(), z.string()),
});
export type AiJudgeResult = z.infer<typeof AiJudgeResult>;

export const RetryRequest = z.object({
  from_stage: z.enum(["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE", "QC"]),
});
export type RetryRequest = z.infer<typeof RetryRequest>;

export const CreateRecipeRequest = z.object({
  title_id: z.string(),
  angle_id: z.string(),
  format: z.enum(["SC", "CP", "SU"]),
  dialect: DialectCode,
  duration_s: z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  ratios: z.array(Ratio).min(1).default(["16:9", "9:16", "1:1"]),
  source_window: z
    .object({ start_ms: z.number(), end_ms: z.number() })
    .nullable()
    .optional(),
  persona_id: z.string().nullable().optional(),
  music_brief: z.string().max(120).nullable().optional(),
  cta_variant: z.string().default("default"),
  created_by: z.string().default("local-operator"),
  seed: z.number().int().optional(),
});
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequest>;
