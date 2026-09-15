import { z } from "zod";
import { DialectCode, FormatCode, Ratio, Verdict } from "./primitives";

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

export const REASON_LABELS: Record<ReasonCode, string> = {
  R01_WRONG_CLAIM: "wrong claim",
  R02_SPOILER: "spoiler",
  R03_CROP_CUT_SUBJECT: "crop cut subject",
  R04_AUDIO_SYNC: "audio sync",
  R05_DIALECT_OFF: "dialect",
  R06_PACING: "pacing",
  R07_WEAK_HOOK: "weak hook",
  R08_TEXT_UNSAFE: "text",
  R09_CTA_WRONG: "CTA",
  R10_LOW_QUALITY: "quality",
  R11_MUSIC_CLASH: "music",
  R12_LIPSYNC: "lipsync",
  R13_WRONG_EVIDENCE: "wrong evidence",
  R14_BORING: "boring",
};

export const LedgerRow = z.object({
  promo_id: z.string(),
  recipe_id: z.string(),
  title_id: z.string(),
  format: FormatCode,
  dialect: DialectCode,
  ratio: Ratio,
  created_at: z.string().datetime(),

  cost_inr: z.number(),
  cost_breakdown: z.record(z.string(), z.number()),
  wall_ms: z.number().int(),

  qc_deterministic: z.record(z.string(), z.boolean()),
  qc_ai: z.record(z.string(), z.union([z.number(), z.boolean()])),

  editor_verdict: Verdict.nullable(),
  editor_reason_codes: z.array(ReasonCode),
  editor_edit_minutes: z.number().nullable(),
  editor_note: z.string().nullable(),

  published_at: z.string().datetime().nullable(),
  impressions: z.number().int().nullable(),
  view_rate_3s: z.number().nullable(),
  completion_rate: z.number().nullable(),
  ctr_to_title: z.number().nullable(),
});
export type LedgerRow = z.infer<typeof LedgerRow>;

/** Review submission (§8). Reason codes required for verdicts 3–4; edit minutes for 2–3. */
export const ReviewRequest = z
  .object({
    verdict: Verdict,
    reason_codes: z.array(ReasonCode).default([]),
    edit_minutes: z.number().nonnegative().nullable().default(null),
    note: z.string().max(500).nullable().default(null),
    reviewer: z.string().default("editor"),
  })
  .superRefine((r, ctx) => {
    if ((r.verdict === "major_edit" || r.verdict === "rejected") && r.reason_codes.length === 0)
      ctx.addIssue({ code: "custom", message: "reason_codes required for major_edit and rejected", path: ["reason_codes"] });
    if ((r.verdict === "minor_edit" || r.verdict === "major_edit") && r.edit_minutes === null)
      ctx.addIssue({ code: "custom", message: "edit_minutes required for minor_edit and major_edit", path: ["edit_minutes"] });
    if (r.verdict === "approved" && r.reason_codes.length > 0)
      ctx.addIssue({ code: "custom", message: "reason_codes are hidden for approved", path: ["reason_codes"] });
  });
export type ReviewRequest = z.infer<typeof ReviewRequest>;

export const OutcomeRow = z.object({
  promo_id: z.string(),
  published_at: z.string().datetime().nullable().optional(),
  impressions: z.number().int().nonnegative(),
  view_3s: z.number().int().nonnegative(),
  views_complete: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
});
export type OutcomeRow = z.infer<typeof OutcomeRow>;
export const OutcomeBatch = z.object({ rows: z.array(OutcomeRow).min(1) });
