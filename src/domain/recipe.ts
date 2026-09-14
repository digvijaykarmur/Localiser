import { z } from "zod";
import { DialectCode, FormatCode, Ratio } from "./codes";
import { EvidenceUnit } from "./evidence";
import { Angle } from "./angle";

export const TitleIntelligence = z.object({
  title_id: z.string(),
  evidence: z.array(EvidenceUnit),
  angles: z.array(Angle).max(6),
  built_at: z.string().datetime(),
});
export type TitleIntelligence = z.infer<typeof TitleIntelligence>;

export const Recipe = z.object({
  id: z.string(),
  version: z.literal(1),
  created_at: z.string().datetime(),
  created_by: z.string(),

  title_id: z.string(),
  angle_id: z.string(),
  format: FormatCode,
  dialect: DialectCode,
  duration_s: z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]),
  ratios: z.array(Ratio).min(1),

  source_window: z
    .object({ start_ms: z.number(), end_ms: z.number() })
    .nullable(),
  persona_id: z.string().nullable(),
  music_brief: z.string().max(120).nullable(),
  cta_variant: z.string(),

  cost_envelope_inr: z.number().positive(),
  planner_prompt_version: z.string(),
  seed: z.number().int(),
});
export type Recipe = z.infer<typeof Recipe>;
