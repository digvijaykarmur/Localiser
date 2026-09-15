import { z } from "zod";
import { DialectCode, Duration, FormatCode, Ratio } from "./primitives";

export const Recipe = z.object({
  id: z.string(),
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  created_by: z.string(),

  title_id: z.string(),
  angle_id: z.string(),
  format: FormatCode,
  dialect: DialectCode,
  duration_s: Duration,
  ratios: z.array(Ratio).min(1),

  source_window: z.object({ start_ms: z.number().int(), end_ms: z.number().int() }).nullable(),
  persona_id: z.string().nullable(),
  music_brief: z.string().max(120).nullable(),
  cta_variant: z.string(),

  cost_envelope_inr: z.number().positive(),
  dialect_pack_version: z.string(),
  prompt_versions: z.record(z.string(), z.string()), // { plan: "plan.v3", script: "script.v2" }
  seed: z.number().int(),
});
export type Recipe = z.infer<typeof Recipe>;

/** Inbound request body for POST /recipes. Everything else is derived server-side. */
export const RecipeRequest = z.object({
  title_id: z.string(),
  angle_id: z.string(),
  format: FormatCode,
  dialect: DialectCode,
  duration_s: Duration,
  ratios: z.array(Ratio).min(1),
  source_window: z.object({ start_ms: z.number().int(), end_ms: z.number().int() }).nullable().default(null),
  persona_id: z.string().nullable().default(null),
  music_brief: z.string().max(120).nullable().default(null),
  cta_variant: z.string().default("default"),
  cost_envelope_inr: z.number().positive().optional(),
  created_by: z.string().default("producer"),
  seed: z.number().int().optional(),
});
export type RecipeRequest = z.infer<typeof RecipeRequest>;

export const Preset = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  format: FormatCode,
  dialect: DialectCode,
  duration_s: Duration,
  ratios: z.array(Ratio).min(1),
  cta_variant: z.string(),
  music_brief: z.string().max(120).nullable(),
  created_at: z.string().datetime(),
});
export type Preset = z.infer<typeof Preset>;

export const PresetRequest = Preset.omit({ id: true, created_at: true });
