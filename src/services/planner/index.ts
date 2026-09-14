import {
  Beat,
  PromoPlan,
  type Angle,
  type EvidenceUnit,
  type Recipe,
  type Ratio,
  type Treatment,
  frameBudget,
  selectTreatment,
  ReferentialEvidenceError,
} from "@/domain";
import { getFormat } from "@/lib/registry";
import { SC_BOUNDARY_REFINE_MS } from "@/domain/codes";
import { buildTrackedCrop } from "./tracked-crop";

const HOOK_MS = 3000;
const STAKE_END_MS = 10000;
const TURN_END_MS = 20000;

export function refineScWindow(
  window: { start_ms: number; end_ms: number },
  scenes: { start_ms: number; end_ms: number }[],
): { start_ms: number; end_ms: number } {
  const start = nearestBoundary(window.start_ms, scenes, "start");
  const end = nearestBoundary(window.end_ms, scenes, "end");
  return {
    start_ms: clampBoundary(window.start_ms, start),
    end_ms: Math.max(clampBoundary(window.end_ms, end), window.start_ms + 700),
  };
}

function nearestBoundary(
  t: number,
  scenes: { start_ms: number; end_ms: number }[],
  which: "start" | "end",
): number {
  let best = t;
  let bestD = Infinity;
  for (const s of scenes) {
    const b = which === "start" ? s.start_ms : s.end_ms;
    const d = Math.abs(b - t);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function clampBoundary(original: number, candidate: number): number {
  if (Math.abs(candidate - original) <= SC_BOUNDARY_REFINE_MS) return candidate;
  return original;
}

function assertEvidence(ids: string[], byId: Map<string, EvidenceUnit>) {
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new ReferentialEvidenceError(missing);
}

function usablePool(
  evidence: EvidenceUnit[],
  spoilerBoundary: number,
  window?: { start_ms: number; end_ms: number } | null,
): EvidenceUnit[] {
  return evidence.filter((e) => {
    if (!e.usable) return false;
    if (e.is_spoiler) return false;
    if (e.start_ms >= spoilerBoundary) return false;
    if (window && (e.end_ms <= window.start_ms || e.start_ms >= window.end_ms)) return false;
    return true;
  });
}

function spineRoles(durationMs: number, formatMin: number, formatMax: number): { role: Beat["role"]; duration_ms: number }[] {
  const cta = durationMs >= 45000 ? 5000 : 4000;
  const hook = Math.min(HOOK_MS, Math.max(700, durationMs - cta - 2100));
  const escalateN = Math.min(Math.max(0, formatMin - 4), Math.max(0, formatMax - 4));
  const roles: Beat["role"][] = ["HOOK", "STAKE", "TURN"];
  for (let i = 0; i < escalateN; i++) roles.push("ESCALATE");
  roles.push("CTA");
  while (roles.length < 4) roles.splice(roles.length - 1, 0, "ESCALATE");
  while (roles.length > formatMax) {
    const idx = roles.indexOf("ESCALATE");
    if (idx < 0) break;
    roles.splice(idx, 1);
  }
  const n = roles.length;
  const durations = Array.from({ length: n }, () => 700);
  durations[0] = hook;
  durations[n - 1] = cta;
  const rest = durationMs - hook - cta;
  const mid = Math.max(1, n - 2);
  const base = Math.max(700, Math.floor(rest / mid));
  for (let i = 1; i < n - 1; i++) durations[i] = base;
  const usedMid = base * mid;
  durations[n - 2] = Math.max(700, durations[n - 2]! + (rest - usedMid));
  const sum = durations.reduce((s, d) => s + d, 0);
  durations[n - 2] = Math.max(700, durations[n - 2]! + (durationMs - sum));
  return roles.map((role, i) => ({ role, duration_ms: durations[i]! }));
}

function pickEvidence(
  role: Beat["role"],
  pool: EvidenceUnit[],
  used: Set<string>,
  prevIntensity: number,
): EvidenceUnit {
  const avail = pool.filter((e) => !used.has(e.id));
  if (avail.length === 0) {
    throw new Error("no unused evidence remaining for beat");
  }
  if (role === "HOOK") {
    const ranked = [...avail].sort((a, b) => b.intensity - a.intensity);
    const notWide = ranked.find((e) => e.shot_type !== "WIDE") ?? ranked[0]!;
    return notWide;
  }
  if (role === "STAKE") {
    return avail.find((e) => e.subject_count >= 1) ?? avail[0]!;
  }
  const rising = avail
    .filter((e) => e.intensity >= prevIntensity)
    .sort((a, b) => a.intensity - b.intensity);
  return rising[0] ?? [...avail].sort((a, b) => b.intensity - a.intensity)[0]!;
}

function treatmentFor(
  unit: EvidenceUnit,
  ratio: Ratio,
  policy: Treatment[],
  compositionFirst: boolean,
): { treatment: Treatment; reason: string } {
  const selected = selectTreatment({
    shotType: unit.shot_type,
    ratio,
    formatPolicy: policy,
    compositionFirst,
    subjectW: unit.subject_boxes[0]?.w,
    motion: unit.motion,
  });
  if (selected.treatment === "TRACKED_CROP") {
    const tracked = buildTrackedCrop(unit, ratio);
    if ("uncroppable" in tracked) {
      const fallback = selectTreatment({
        shotType: unit.shot_type,
        ratio,
        formatPolicy: policy.filter((t) => t !== "TRACKED_CROP"),
        compositionFirst: true,
        subjectW: unit.subject_boxes[0]?.w,
        motion: unit.motion,
      });
      return { treatment: fallback.treatment, reason: tracked.note };
    }
  }
  return selected;
}

export function planPromo(args: {
  recipe: Recipe;
  evidence: EvidenceUnit[];
  angle: Angle;
  scenes: { start_ms: number; end_ms: number }[];
  spoilerBoundary: number;
  ratio: Ratio;
}): PromoPlan {
  const format = getFormat(args.recipe.format);
  const policy = (format.ratio_policy[args.recipe.ratios.includes(args.ratio) ? args.ratio : args.ratio] ??
    format.ratio_policy[args.ratio]) as Treatment[];

  let window = args.recipe.source_window;
  if (args.recipe.format === "SC" && window) {
    window = refineScWindow(window, args.scenes);
  }

  const rawPool = usablePool(args.evidence, args.spoilerBoundary, args.recipe.format === "SC" ? window : null);
  if (rawPool.length === 0) throw new Error("no usable evidence in window");
  const preferred = rawPool.filter(
    (e) => args.angle.evidence_ids.includes(e.id) || args.angle.hook_candidate_ids.includes(e.id),
  );
  const pool = preferred.length >= 4 ? preferred : rawPool;

  const budget = frameBudget(pool, args.ratio);
  const durationMs = args.recipe.duration_s * 1000;
  const formatMin = args.recipe.format === "SC" ? 4 : format.beats.min;
  const formatMax = args.recipe.format === "SC" ? 9 : format.beats.max;
  const roles = spineRoles(durationMs, formatMin, formatMax);

  const used = new Set<string>();
  const beats: Beat[] = [];
  let t = 0;
  let prevIntensity = 1;
  const byId = new Map(args.evidence.map((e) => [e.id, e]));

  for (let i = 0; i < roles.length; i++) {
    const spec = roles[i]!;
    const unit = pickEvidence(spec.role, pool, used, prevIntensity);
    if (used.has(unit.id)) {
      throw new Error(`not enough unique evidence units for ${roles.length} beats`);
    }
    used.add(unit.id);
    if (spec.role === "HOOK") {
      /* keep highest intensity; chronological SC still uses this unit's footage in timeline builder */
    }
    const tr = treatmentFor(unit, args.ratio, policy, budget.composition_first);
    const intensity =
      spec.role === "HOOK"
        ? unit.intensity
        : spec.role === "CTA"
          ? unit.intensity
          : Math.max(unit.intensity, prevIntensity);
    if (spec.role !== "HOOK" && spec.role !== "CTA") prevIntensity = intensity;
    beats.push(
      Beat.parse({
        index: i,
        role: spec.role,
        start_ms: t,
        duration_ms: spec.duration_ms,
        evidence_ids: [unit.id],
        intensity,
        treatment: tr.treatment,
        treatment_reason: tr.reason.slice(0, 160),
        script_line_id: null,
        caption_text: null,
      }),
    );
    t += spec.duration_ms;
  }

  const allIds = beats.flatMap((b) => b.evidence_ids);
  assertEvidence(allIds, byId);

  const plan = PromoPlan.parse({
    recipe_id: args.recipe.id,
    ratio: args.ratio,
    beats,
    frame_budget: budget,
    total_duration_ms: durationMs,
  });
  return plan;
}

export function validatePlanAgainstEvidence(plan: PromoPlan, evidence: EvidenceUnit[], spoilerBoundary: number) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const seen = new Set<string>();
  let prev = 0;
  for (const beat of plan.beats) {
    if (beat.evidence_ids.length < 1) throw new Error("EGC: empty evidence_ids");
    for (const eid of beat.evidence_ids) {
      const u = byId.get(eid);
      if (!u) throw new ReferentialEvidenceError([eid]);
      if (u.start_ms >= spoilerBoundary) throw new Error(`spoiler evidence ${eid}`);
      if (seen.has(eid)) throw new Error(`evidence reused ${eid}`);
      seen.add(eid);
    }
    if (beat.role !== "HOOK" && beat.role !== "CTA") {
      if (beat.intensity < prev) throw new Error("intensity not monotonic");
      prev = beat.intensity;
    }
  }
}
