import { z } from "zod";
import { FormatCode } from "./primitives";
import { Treatment } from "./plan";

/** Format policy — `/src/data/formats/{SC,CP,SU}.json`. Formats configure shared components. */
export const FormatPolicy = z.object({
  code: FormatCode,
  name: z.string(),
  description: z.string(),
  cta_duration_s: z.number().int().min(3).max(6),
  default_envelope_inr: z.number().positive(),
  spine: z.enum(["full", "light"]),
  min_usable_evidence: z.number().int().positive(),
  has_vo: z.boolean(),
  has_music: z.boolean(),
  has_presenter: z.boolean(),
  has_captions: z.boolean(),
  keep_source_audio: z.boolean(),
  allowed_treatments: z.array(Treatment).min(1),
  /** composition used at 9:16 / 1:1 when composition_first is true */
  composition_default: Treatment,
  ai_generated_assets: z.boolean(),
  prompt_versions: z.record(z.string(), z.string()),
});
export type FormatPolicy = z.infer<typeof FormatPolicy>;

/** Minimum usable evidence for a duration (§13 "No usable evidence"). */
export function minEvidenceForDuration(durationS: number, policy: FormatPolicy): number {
  if (policy.spine === "light") return policy.min_usable_evidence;
  // Five-beat spine: HOOK + STAKE + TURN + ESCALATE×n; roughly one unit per 5s excluding CTA.
  return Math.max(policy.min_usable_evidence, Math.ceil((durationS - policy.cta_duration_s) / 5));
}
