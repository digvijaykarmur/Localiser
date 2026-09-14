import { z } from "zod";
import { DialectCode } from "./codes";

export const ReasonCode = z.enum([
  "R01_WRONG_CLAIM",
  "R02_SPOILER",
  "R03_CROP_CUT_SUBJECT",
  "R04_AUDIO_SYNC",
  "R05_DIALECT_OFF",
  "R06_PACING",
  "R07_WEAK_HOOK",
  "R08_TEXT_UNSAFE",
  "R09_CTA_WRONG",
  "R10_LOW_QUALITY",
  "R11_MUSIC_CLASH",
  "R12_LIPSYNC",
  "R13_WRONG_EVIDENCE",
  "R14_BORING",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const EditorVerdict = z.enum([
  "approved",
  "minor_edit",
  "major_edit",
  "rejected",
]);
export type EditorVerdict = z.infer<typeof EditorVerdict>;

export const LedgerRow = z.object({
  promo_id: z.string(),
  recipe_id: z.string(),
  title_id: z.string(),
  format: z.string(),
  dialect: DialectCode,
  ratio: z.string(),
  created_at: z.string().datetime(),

  cost_inr: z.number(),
  cost_breakdown: z.record(z.string(), z.number()),
  wall_ms: z.number().int(),

  qc_deterministic_pass: z.boolean(),
  qc_ai_scores: z.record(z.string(), z.number()),

  editor_verdict: EditorVerdict.nullable(),
  editor_reason_codes: z.array(ReasonCode),
  editor_edit_minutes: z.number().nullable(),

  published_at: z.string().datetime().nullable(),
  impressions: z.number().int().nullable(),
  view_rate_3s: z.number().nullable(),
  completion_rate: z.number().nullable(),
  ctr_to_title: z.number().nullable(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;
