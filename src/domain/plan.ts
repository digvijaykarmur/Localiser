import { z } from "zod";
import { Ratio } from "./primitives";

export const Treatment = z.enum([
  "NATIVE",
  "TRACKED_CROP",
  "STATIC_CROP",
  "SPEAKER_CUT",
  "STACKED",
  "CAPTION_DOMINANT",
  "INSET",
  "KENBURNS_STILL",
  "GENERATED_NATIVE",
]);
export type Treatment = z.infer<typeof Treatment>;

export const BeatRole = z.enum(["HOOK", "STAKE", "TURN", "ESCALATE", "CTA"]);
export type BeatRole = z.infer<typeof BeatRole>;

export const Beat = z.object({
  index: z.number().int().nonnegative(),
  role: BeatRole,
  start_ms: z.number().int().nonnegative(),
  duration_ms: z.number().int().min(700),
  evidence_ids: z.array(z.string()).min(1), // EGC
  intensity: z.number().int().min(1).max(10),
  treatment: Treatment,
  treatment_reason: z.string().max(160),
  script_line_id: z.string().nullable(),
  caption_text: z.string().nullable(),
});
export type Beat = z.infer<typeof Beat>;

export const FrameBudget = z.object({
  croppable_fraction: z.number().min(0).max(1),
  composition_first: z.boolean(),
  chosen_composition: Treatment.nullable(),
});
export type FrameBudget = z.infer<typeof FrameBudget>;

/** Shared refinement: SPINE monotonicity and no evidence reuse. */
function refinePlanBeats(beats: Beat[], ctx: z.RefinementCtx) {
  const ordered = beats.filter((b) => b.role !== "HOOK" && b.role !== "CTA");
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.intensity < ordered[i - 1]!.intensity) {
      ctx.addIssue({ code: "custom", message: `intensity drops at beat ${ordered[i]!.index}` });
    }
  }
  const seen = new Set<string>();
  for (const b of beats)
    for (const e of b.evidence_ids) {
      if (seen.has(e)) ctx.addIssue({ code: "custom", message: `evidence ${e} reused` });
      seen.add(e);
    }
}

export const PromoPlan = z
  .object({
    recipe_id: z.string(),
    ratio: Ratio,
    beats: z.array(Beat).min(1).max(9),
    frame_budget: FrameBudget,
    total_duration_ms: z.number().int(),
  })
  .superRefine((p, ctx) => refinePlanBeats(p.beats, ctx));
export type PromoPlan = z.infer<typeof PromoPlan>;

/**
 * What the planning model returns. It proposes structure only; `treatment` is a proposal
 * that code overrides (§17.3), and start_ms is derived from durations by code.
 */
export const PlanProposalBeat = z.object({
  role: BeatRole,
  duration_ms: z.number().int().min(700),
  evidence_ids: z.array(z.string()).min(1),
  intensity: z.number().int().min(1).max(10),
  treatment: Treatment,
  treatment_reason: z.string().max(160),
  caption_text: z.string().nullable(),
});
export type PlanProposalBeat = z.infer<typeof PlanProposalBeat>;

export const PlanProposal = z.object({ beats: z.array(PlanProposalBeat).min(1).max(9) });
export type PlanProposal = z.infer<typeof PlanProposal>;

export const ROLE_ORDER: Record<BeatRole, number> = { HOOK: 0, STAKE: 1, TURN: 2, ESCALATE: 3, CTA: 4 };

export type SpineIssue = string;

/**
 * SPINE (§3.6, §14.4): exactly HOOK, STAKE, TURN, ESCALATE×n (1..4), CTA — in that order.
 * Hook intensity must be the highest intensity available among the cited hook candidates.
 */
export function validateSpine(beats: Pick<Beat, "role" | "intensity" | "index">[]): SpineIssue[] {
  const issues: SpineIssue[] = [];
  const roles = beats.map((b) => b.role);
  const count = (r: BeatRole) => roles.filter((x) => x === r).length;
  if (count("HOOK") !== 1) issues.push(`expected exactly one HOOK, got ${count("HOOK")}`);
  if (count("STAKE") !== 1) issues.push(`expected exactly one STAKE, got ${count("STAKE")}`);
  if (count("TURN") !== 1) issues.push(`expected exactly one TURN, got ${count("TURN")}`);
  if (count("CTA") !== 1) issues.push(`expected exactly one CTA, got ${count("CTA")}`);
  const esc = count("ESCALATE");
  if (esc < 1 || esc > 4) issues.push(`expected 1–4 ESCALATE beats, got ${esc}`);
  for (let i = 1; i < roles.length; i++) {
    if (ROLE_ORDER[roles[i]!] < ROLE_ORDER[roles[i - 1]!]) {
      issues.push(`role order violated at beat ${i}: ${roles[i - 1]} → ${roles[i]}`);
      break;
    }
  }
  if (roles[0] !== "HOOK") issues.push("first beat must be HOOK");
  if (roles[roles.length - 1] !== "CTA") issues.push("last beat must be CTA");
  const stake = beats.find((b) => b.role === "STAKE");
  const turn = beats.find((b) => b.role === "TURN");
  if (stake && turn && turn.intensity <= stake.intensity) issues.push("TURN intensity must exceed STAKE");
  return issues;
}

/** Beats of a light-spine format (Single Clip): HOOK, 0–2 ESCALATE, CTA. */
export function validateLightSpine(beats: Pick<Beat, "role">[]): SpineIssue[] {
  const issues: SpineIssue[] = [];
  const roles = beats.map((b) => b.role);
  if (roles[0] !== "HOOK") issues.push("first beat must be HOOK");
  if (roles[roles.length - 1] !== "CTA") issues.push("last beat must be CTA");
  const middle = roles.slice(1, -1);
  if (middle.some((r) => r !== "ESCALATE")) issues.push("Single Clip may only contain HOOK, ESCALATE and CTA");
  if (middle.length > 2) issues.push("Single Clip allows at most two ESCALATE beats");
  return issues;
}
