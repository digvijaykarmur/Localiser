import { models } from "@/config/models";
import type {
  Beat} from "@/domain";
import {
  frameBudget,
  planTrackedCrop,
  PlanProposal,
  PromoPlan,
  samplesFromBoxes,
  selectTreatment,
  validateLightSpine,
  validateSpine,
  type Angle,
  type DialectPack,
  type EvidenceUnit,
  type FormatPolicy,
  type Ratio,
  type Recipe,
  type Title,
  type Treatment,
} from "@/domain";
import { PLAN_V3, withInput } from "@/prompts";
import { callModel } from "../cost/modelClient";
import type { CostMeter } from "../cost/meter";

export interface PlanContext {
  recipe: Recipe;
  title: Title;
  angle: Angle;
  evidence: EvidenceUnit[]; // eligible evidence (usable, pre-boundary, non-spoiler)
  pack: DialectPack;
  policy: FormatPolicy;
  meter: CostMeter;
  jobId: string;
  /** 16:9 plan, when planning the other ratios, so beat structure stays aligned for the shared script. */
  reference?: PromoPlan | null;
}

/** S4 — plan one ratio (§17.3). The model proposes structure; code decides composition. */
export async function buildPlan(ctx: PlanContext, ratio: Ratio): Promise<{ plan: PromoPlan; cost_inr: number }> {
  const { recipe, angle, pack, policy, evidence } = ctx;
  const angleEvidence = evidence.filter((e) => angle.evidence_ids.includes(e.id));
  const pool = angleEvidence.length >= 2 ? angleEvidence : evidence;
  const fb = frameBudget(pool, ratio, policy.composition_default);
  const ctaMs = policy.cta_duration_s * 1000;
  const targetBodyMs = recipe.duration_s * 1000 - ctaMs;
  const known = new Map(evidence.map((e) => [e.id, e]));
  const hookMax = Math.max(...angle.hook_candidate_ids.map((id) => known.get(id)?.intensity ?? 0), 0);

  const input = {
    recipe: { id: recipe.id, format: recipe.format, duration_s: recipe.duration_s, ratio, dialect: recipe.dialect, cta_variant: recipe.cta_variant },
    spine: policy.spine,
    angle: { kind: angle.kind, claim: angle.claim, evidence_ids: angle.evidence_ids, hook_candidate_ids: angle.hook_candidate_ids },
    hook_candidate_ids: angle.hook_candidate_ids,
    target_body_ms: targetBodyMs,
    cta_ms: ctaMs,
    beat_min_ms: pack.rhythm.beat_min_ms,
    beat_max_ms: pack.rhythm.beat_max_ms,
    hook_max_ms: pack.rhythm.hook_max_ms,
    spoiler_boundary_ms: ctx.title.spoiler_boundary_ms,
    frame_budget: fb,
    reference_structure: ctx.reference ? ctx.reference.beats.map((b) => ({ role: b.role, duration_ms: b.duration_ms, evidence_ids: b.evidence_ids })) : null,
    evidence: evidence.map((e) => ({
      id: e.id,
      start_ms: e.start_ms,
      end_ms: e.end_ms,
      description: e.description,
      shot_type: e.shot_type,
      subject_count: e.subject_count,
      motion: e.motion,
      intensity: e.intensity,
      has_dialogue: e.has_dialogue,
      dialogue_native: e.dialogue_native,
      is_spoiler: e.is_spoiler,
      croppable_at_ratio: ratio === "9:16" ? e.croppable_916 : ratio === "1:1" ? e.croppable_11 : true,
    })),
  };

  const r = await callModel({
    schema: PlanProposal,
    model: models.plan.model,
    temperature: models.plan.temperature ?? 0.7,
    seed: recipe.seed,
    system: PLAN_V3.system,
    user: [{ text: withInput(ctx.reference ? "Plan this ratio. Keep the reference beat structure (same roles, count and evidence) unless the frame budget forces a substitution." : "Plan this promo.", input) }],
    meta: { stage: "plan", prompt_version: PLAN_V3.version, recipe_id: recipe.id, title_id: recipe.title_id, job_id: ctx.jobId },
    meter: ctx.meter,
    costItem: "vertex.plan",
    verify: (p) => verifyProposal(p, { known, policy, pack, targetBodyMs, ctaMs, hookMax, hookIds: angle.hook_candidate_ids }),
  });

  const plan = composePlan(r.value, { recipe, ratio, policy, known, fb });
  return { plan, cost_inr: r.cost_inr };
}

export function verifyProposal(
  p: PlanProposal,
  o: { known: Map<string, EvidenceUnit>; policy: FormatPolicy; pack: DialectPack; targetBodyMs: number; ctaMs: number; hookMax: number; hookIds: string[] },
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  let body = 0;
  p.beats.forEach((b, i) => {
    for (const id of b.evidence_ids) {
      const e = o.known.get(id);
      if (!e) issues.push(`beat ${i}: evidence ${id} is unknown, unusable, a spoiler, or after the spoiler boundary`);
      if (seen.has(id)) issues.push(`beat ${i}: evidence ${id} reused (the CTA must cite an id no other beat uses)`);
      seen.add(id);
    }
    if (b.role === "CTA") {
      if (b.duration_ms !== o.ctaMs) issues.push(`CTA beat must be exactly ${o.ctaMs}ms`);
    } else {
      body += b.duration_ms;
      const primary = o.known.get(b.evidence_ids[0] ?? "");
      const unitLen = primary ? primary.end_ms - primary.start_ms : Infinity;
      if (b.duration_ms < o.pack.rhythm.beat_min_ms) issues.push(`beat ${i}: ${b.duration_ms}ms < beat_min_ms ${o.pack.rhythm.beat_min_ms}`);
      // Five-beat spine beats are capped by the dialect's rhythm; a Single Clip beat is one
      // continuous moment and is capped only by the length of the evidence it shows.
      if (o.policy.spine === "full" && b.duration_ms > o.pack.rhythm.beat_max_ms) issues.push(`beat ${i}: ${b.duration_ms}ms > beat_max_ms ${o.pack.rhythm.beat_max_ms}`);
      if (b.duration_ms > unitLen) issues.push(`beat ${i}: ${b.duration_ms}ms exceeds the ${unitLen}ms of evidence ${b.evidence_ids[0]}`);
      if (b.role === "HOOK" && b.duration_ms > o.pack.rhythm.hook_max_ms) issues.push(`HOOK ${b.duration_ms}ms > hook_max_ms ${o.pack.rhythm.hook_max_ms}`);
    }
  });
  if (Math.abs(body - o.targetBodyMs) > 200) issues.push(`non-CTA beats sum to ${body}ms; target ${o.targetBodyMs}ms ±200`);
  const spineIssues = o.policy.spine === "full" ? validateSpine(p.beats.map((b, i) => ({ ...b, index: i }))) : validateLightSpine(p.beats);
  issues.push(...spineIssues);
  const hook = p.beats.find((b) => b.role === "HOOK");
  if (hook) {
    const hookEv = o.known.get(hook.evidence_ids[0] ?? "");
    if (hookEv && hookEv.shot_type === "WIDE" && hookEv.subject_count === 0) issues.push("HOOK must not be an establishing wide");
    if (hookEv && o.hookMax > 0 && hookEv.intensity < o.hookMax) issues.push(`HOOK intensity ${hookEv.intensity} is below the strongest hook candidate (${o.hookMax}); use the highest-intensity evidence`);
  }
  return issues;
}

/** Code decides composition: indices, start times, treatments, frame budget. */
export function composePlan(
  proposal: PlanProposal,
  o: { recipe: Recipe; ratio: Ratio; policy: FormatPolicy; known: Map<string, EvidenceUnit>; fb: ReturnType<typeof frameBudget> },
): PromoPlan {
  let t = 0;
  const beats: Beat[] = proposal.beats.map((b, index) => {
    const primary = o.known.get(b.evidence_ids[0]!)!;
    let treatment: Treatment;
    let reason: string;
    if (b.role === "CTA") {
      treatment = "NATIVE";
      reason = "CTA card: designed asset, nothing to compose";
    } else {
      const subjectW = primary.subject_boxes[0]?.w ?? null;
      const sel = selectTreatment(primary.shot_type, o.ratio, subjectW, primary.motion, o.fb.composition_first, o.policy.allowed_treatments, o.fb.chosen_composition);
      treatment = sel.treatment;
      reason = sel.reason;
      // A presenter format keeps its presenter in every ratio: at 16:9 the source stays native
      // and uncropped inside the STACKED column layout instead of filling the canvas alone.
      if (o.ratio === "16:9" && o.policy.has_presenter && o.policy.allowed_treatments.includes("STACKED")) {
        treatment = "STACKED";
        reason = "16:9 presenter column beside the native, uncropped source";
      }
      if (treatment === "TRACKED_CROP") {
        const tracked = planTrackedCrop(o.ratio, samplesFromBoxes(primary.subject_boxes, b.duration_ms));
        if (!tracked) {
          treatment = o.policy.allowed_treatments.includes(o.policy.composition_default) ? o.policy.composition_default : "CAPTION_DOMINANT";
          reason = `tracked crop would exceed 8% width/s → ${treatment}`;
        }
      }
      if (treatment === "KENBURNS_STILL" && b.duration_ms < 2000) {
        treatment = "CAPTION_DOMINANT";
        reason = "KENBURNS_STILL needs ≥2000ms → CAPTION_DOMINANT";
      }
    }
    const beat: Beat = {
      index,
      role: b.role,
      start_ms: t,
      duration_ms: b.duration_ms,
      evidence_ids: b.evidence_ids,
      intensity: b.intensity,
      treatment,
      treatment_reason: reason.slice(0, 160),
      script_line_id: null,
      caption_text: b.caption_text,
    };
    t += b.duration_ms;
    return beat;
  });
  // at most two Ken Burns beats per promo
  let kb = 0;
  for (const b of beats)
    if (b.treatment === "KENBURNS_STILL" && ++kb > 2) {
      b.treatment = "CAPTION_DOMINANT";
      b.treatment_reason = "max two KENBURNS_STILL per promo → CAPTION_DOMINANT";
    }
  return PromoPlan.parse({ recipe_id: o.recipe.id, ratio: o.ratio, beats, frame_budget: o.fb, total_duration_ms: t });
}
