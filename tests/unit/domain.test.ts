import { describe, expect, it } from "vitest";
import {
  PromoPlan,
  Timeline,
  validateSpine,
  validateLightSpine,
  countWords,
  wordBudget,
  withinBudget,
  applyLexiconReplace,
  findAvoidWords,
  bumpPackVersion,
  computeTier,
  median,
  spearman,
  textSimilarity,
  ReviewRequest,
  planTrackedCrop,
  samplesFromBoxes,
  peakVelocityFrac,
  computeVerticalFeasible,
  type EvidenceUnit,
} from "@/domain";

const beat = (index: number, role: "HOOK" | "STAKE" | "TURN" | "ESCALATE" | "CTA", intensity: number, ev: string[]) => ({
  index,
  role,
  start_ms: index * 3000,
  duration_ms: 3000,
  evidence_ids: ev,
  intensity,
  treatment: "NATIVE" as const,
  treatment_reason: "test",
  script_line_id: null,
  caption_text: null,
});

describe("PromoPlan schema refinements (SPINE + no evidence reuse)", () => {
  const base = { recipe_id: "r", ratio: "16:9" as const, frame_budget: { croppable_fraction: 1, composition_first: false, chosen_composition: null }, total_duration_ms: 15000 };
  it("accepts a monotonic plan", () => {
    const r = PromoPlan.safeParse({
      ...base,
      beats: [beat(0, "HOOK", 9, ["a"]), beat(1, "STAKE", 4, ["b"]), beat(2, "TURN", 6, ["c"]), beat(3, "ESCALATE", 7, ["d"]), beat(4, "CTA", 7, ["e"])],
    });
    expect(r.success).toBe(true);
  });
  it("rejects an intensity drop between STAKE and ESCALATE", () => {
    const r = PromoPlan.safeParse({
      ...base,
      beats: [beat(0, "HOOK", 9, ["a"]), beat(1, "STAKE", 6, ["b"]), beat(2, "TURN", 4, ["c"]), beat(3, "CTA", 7, ["e"])],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/intensity drops at beat 2/);
  });
  it("rejects evidence reuse", () => {
    const r = PromoPlan.safeParse({ ...base, beats: [beat(0, "HOOK", 9, ["a"]), beat(1, "STAKE", 4, ["a"]), beat(2, "CTA", 7, ["e"])] });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/evidence a reused/);
  });
  it("validateSpine requires the full five-beat spine in order", () => {
    expect(validateSpine([beat(0, "HOOK", 9, []), beat(1, "STAKE", 4, []), beat(2, "TURN", 6, []), beat(3, "ESCALATE", 7, []), beat(4, "CTA", 7, [])])).toEqual([]);
    expect(validateSpine([beat(0, "STAKE", 4, []), beat(1, "HOOK", 9, []), beat(2, "TURN", 6, []), beat(3, "ESCALATE", 7, []), beat(4, "CTA", 7, [])]).length).toBeGreaterThan(0);
    expect(validateSpine([beat(0, "HOOK", 9, []), beat(1, "STAKE", 6, []), beat(2, "TURN", 6, []), beat(3, "ESCALATE", 7, []), beat(4, "CTA", 7, [])])).toContain("TURN intensity must exceed STAKE");
    expect(validateSpine([beat(0, "HOOK", 9, []), beat(1, "STAKE", 4, []), beat(2, "TURN", 6, []), beat(3, "CTA", 7, [])])).toContain("expected 1–4 ESCALATE beats, got 0");
  });
  it("validateLightSpine for Single Clip", () => {
    expect(validateLightSpine([beat(0, "HOOK", 9, []), beat(1, "CTA", 7, [])])).toEqual([]);
    expect(validateLightSpine([beat(0, "HOOK", 9, []), beat(1, "ESCALATE", 9, []), beat(2, "CTA", 7, [])])).toEqual([]);
    expect(validateLightSpine([beat(0, "HOOK", 9, []), beat(1, "STAKE", 9, []), beat(2, "CTA", 7, [])]).length).toBe(1);
  });
});

describe("Timeline schema refinements", () => {
  const layer = (dest: { x: number; y: number; w: number; h: number }, extra: Record<string, unknown> = {}) => ({
    id: "l1",
    z: 1,
    type: "source_clip",
    start_ms: 0,
    end_ms: 1000,
    dest,
    asset_id: "a",
    source_in_ms: 0,
    source_out_ms: 1000,
    src_crop: null,
    crop_keyframes: null,
    fill_color: null,
    opacity: 1,
    ...extra,
  });
  const audio = [{ id: "a1", role: "source", asset_id: "a", start_ms: 0, source_in_ms: 0, source_out_ms: 1000, gain_db: 0, duck_against: null, fade_in_ms: 0, fade_out_ms: 0 }];
  const base = { recipe_id: "r", ratio: "9:16", width: 1080, height: 1920, fps: 30, duration_ms: 1000 };
  it("rejects a layer outside the canvas", () => {
    const r = Timeline.safeParse({ ...base, layers: [layer({ x: 0, y: 1500, w: 1080, h: 608 })], audio });
    expect(r.success).toBe(false);
  });
  it("rejects both static and tracked crop", () => {
    const r = Timeline.safeParse({
      ...base,
      layers: [layer({ x: 0, y: 0, w: 1080, h: 1920 }, { src_crop: { x: 0, y: 0, w: 608, h: 1080 }, crop_keyframes: [{ t_ms: 0, box: { x: 0, y: 0, w: 608, h: 1080 } }] })],
      audio,
    });
    expect(r.success).toBe(false);
  });
  it("rejects no audio", () => {
    expect(Timeline.safeParse({ ...base, layers: [layer({ x: 0, y: 0, w: 1080, h: 1920 })], audio: [] }).success).toBe(false);
  });
});

describe("DAL word budget (§17.4, §20.3)", () => {
  it("30s CP, 5s CTA, 2.4 wps → 60 words", () => {
    expect(wordBudget(30, 5, 2.4)).toBe(60);
  });
  it("counts Devanagari words ignoring danda punctuation", () => {
    expect(countWords("अब देख ल्यो — कल्याणी का सच, सिर्फ STAGE पै।")).toBe(9);
  });
  it("withinBudget fires on a wordy script", () => {
    expect(withinBudget(60, 2.4, 30, 5)).toBe(true);
    expect(withinBudget(61, 2.4, 30, 5)).toBe(false);
  });
  it("applies replace map longest-key-first", () => {
    expect(applyLexiconReplace("बहुत अच्छा, तुम क्या करते हो", { बहुत: "घणा", क्या: "के", तुम: "थम" })).toBe("घणा अच्छा, थम के करते हो");
  });
  it("finds avoid words", () => {
    expect(findAvoidWords("यह अत्यंत सुंदर है", ["अत्यंत", "परंतु"])).toEqual(["अत्यंत"]);
  });
  it("bumps pack versions", () => {
    expect(bumpPackVersion("hry.v3", "hry")).toBe("hry.v4");
    expect(bumpPackVersion("weird", "hry")).toBe("hry.v1");
  });
});

describe("PPP tier (§33)", () => {
  it("PROVE below 20", () => expect(computeTier({ promos: 19, approval_rate: 1, median_edit_minutes: 0, recent_r01_r02: 0 })).toBe("PROVE"));
  it("PILOT at 20 / 60% / ≤10", () => expect(computeTier({ promos: 20, approval_rate: 0.6, median_edit_minutes: 10, recent_r01_r02: 3 })).toBe("PILOT"));
  it("PRODUCTION at 50 / 80% / ≤4 / zero R01-R02", () =>
    expect(computeTier({ promos: 50, approval_rate: 0.8, median_edit_minutes: 4, recent_r01_r02: 0 })).toBe("PRODUCTION"));
  it("falls back to PILOT with any R01/R02", () =>
    expect(computeTier({ promos: 50, approval_rate: 0.9, median_edit_minutes: 2, recent_r01_r02: 1 })).toBe("PILOT"));
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("spearman", () => {
    expect(spearman([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("text similarity (A5)", () => {
  it("identical → 1", () => expect(textSimilarity("अब देख ल्यो", "अब देख ल्यो")).toBe(1));
  it("punctuation-insensitive", () => expect(textSimilarity("अब देख ल्यो।", "अब, देख ल्यो")).toBeGreaterThan(0.95));
  it("different → low", () => expect(textSimilarity("अब देख ल्यो", "कुछ और ही बात")).toBeLessThan(0.5));
});

describe("ReviewRequest rules (§8)", () => {
  it("reason codes required for rejected", () => {
    expect(ReviewRequest.safeParse({ verdict: "rejected" }).success).toBe(false);
    expect(ReviewRequest.safeParse({ verdict: "rejected", reason_codes: ["R14_BORING"] }).success).toBe(true);
  });
  it("edit minutes required for minor_edit", () => {
    expect(ReviewRequest.safeParse({ verdict: "minor_edit" }).success).toBe(false);
    expect(ReviewRequest.safeParse({ verdict: "minor_edit", edit_minutes: 3 }).success).toBe(true);
  });
  it("approved takes no reason codes", () => {
    expect(ReviewRequest.safeParse({ verdict: "approved" }).success).toBe(true);
    expect(ReviewRequest.safeParse({ verdict: "approved", reason_codes: ["R06_PACING"] }).success).toBe(false);
  });
});

describe("tracked crop planning (§19.6)", () => {
  it("a held subject produces a two-keyframe hold with zero velocity", () => {
    const s = samplesFromBoxes([{ x: 0.2, y: 0.2, w: 0.2, h: 0.4, is_speaking: true, label: "a" }], 3000);
    const r = planTrackedCrop("9:16", s);
    expect(r).not.toBeNull();
    expect(r!.peak_velocity).toBe(0);
    expect(r!.keyframes[0]!.box).toEqual({ x: 272, y: 0, w: 608, h: 1080 });
  });
  it("rejects a path faster than 8% width per second", () => {
    const fast = [
      { t_ms: 0, cx: 0.1, cy: 0.5 },
      { t_ms: 250, cx: 0.9, cy: 0.5 },
    ];
    // smoothing damps it, but velocity across a 250ms hop stays far above the limit
    expect(planTrackedCrop("9:16", fast)).toBeNull();
  });
  it("peakVelocityFrac computes fraction of master width per second", () => {
    expect(
      peakVelocityFrac([
        { t_ms: 0, box: { x: 0, y: 0, w: 608, h: 1080 } },
        { t_ms: 1000, box: { x: 192, y: 0, w: 608, h: 1080 } },
      ]),
    ).toBeCloseTo(0.1);
  });
});

describe("computeVerticalFeasible", () => {
  const ev = (id: string, c916: boolean, dialogue = false): EvidenceUnit => ({
    id,
    title_id: "t",
    start_ms: 0,
    end_ms: 1000,
    frame_urls: ["a", "b", "c"],
    description: "d",
    shot_type: "CU",
    subject_count: 1,
    subject_boxes: [],
    motion: "low",
    emotion: [],
    intensity: 5,
    has_dialogue: dialogue,
    dialogue_native: null,
    is_spoiler: false,
    usable: true,
    unusable_reason: null,
    croppable_11: true,
    croppable_916: c916,
    crop_note: null,
  });
  const p = (ids: string[]) => ({ kind: "conflict" as const, claim: "c", evidence_ids: ids, hook_candidate_ids: [ids[0]!], audience_note: "", spoiler_safe: true });
  it("feasible when ≥60% croppable", () => {
    const m = new Map([["a", ev("a", true)], ["b", ev("b", true)], ["c", ev("c", false)]]);
    expect(computeVerticalFeasible(p(["a", "b", "c"]), m)).toBe(true);
  });
  it("feasible via two dialogue units even when nothing crops", () => {
    const m = new Map([["a", ev("a", false, true)], ["b", ev("b", false, true)], ["c", ev("c", false)]]);
    expect(computeVerticalFeasible(p(["a", "b", "c"]), m)).toBe(true);
  });
  it("infeasible otherwise", () => {
    const m = new Map([["a", ev("a", false)], ["b", ev("b", false)], ["c", ev("c", false)]]);
    expect(computeVerticalFeasible(p(["a", "b", "c"]), m)).toBe(false);
  });
});
