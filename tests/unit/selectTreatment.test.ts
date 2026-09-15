import { describe, expect, it } from "vitest";
import { selectTreatment, ShotType, Treatment, Ratio, treatmentViolations, frameBudget } from "@/domain";

const ALL = Treatment.options;

describe("selectTreatment — full matrix (§19.3)", () => {
  it("16:9 is always NATIVE for every shot", () => {
    for (const shot of ShotType.options) {
      expect(selectTreatment(shot, "16:9", 0.2, "low", false, ALL).treatment).toBe("NATIVE");
    }
  });

  const expected11: Record<string, string> = {
    ECU: "TRACKED_CROP",
    CU: "TRACKED_CROP",
    MCU: "TRACKED_CROP",
    MS: "TRACKED_CROP",
    TWO_SHOT: "SPEAKER_CUT",
    GROUP: "CAPTION_DOMINANT",
    WIDE: "CAPTION_DOMINANT",
    INSERT: "TRACKED_CROP",
    ACTION: "TRACKED_CROP",
  };
  for (const [shot, t] of Object.entries(expected11)) {
    it(`1:1 ${shot} → ${t}`, () => {
      expect(selectTreatment(shot as never, "1:1", 0.2, "medium", false, ALL).treatment).toBe(t);
    });
  }

  const expected916: Record<string, string> = {
    ECU: "TRACKED_CROP",
    CU: "TRACKED_CROP",
    MCU: "TRACKED_CROP",
    TWO_SHOT: "CAPTION_DOMINANT",
    GROUP: "CAPTION_DOMINANT",
    INSERT: "TRACKED_CROP",
  };
  for (const [shot, t] of Object.entries(expected916)) {
    it(`9:16 ${shot} → ${t}`, () => {
      expect(selectTreatment(shot as never, "9:16", 0.2, "medium", false, ALL).treatment).toBe(t);
    });
  }

  it("9:16 MS: TRACKED_CROP if subjectW < 0.27 else CAPTION_DOMINANT", () => {
    expect(selectTreatment("MS", "9:16", 0.26, "low", false, ALL).treatment).toBe("TRACKED_CROP");
    expect(selectTreatment("MS", "9:16", 0.27, "low", false, ALL).treatment).toBe("CAPTION_DOMINANT");
    expect(selectTreatment("MS", "9:16", null, "low", false, ALL).treatment).toBe("CAPTION_DOMINANT");
  });

  it("9:16 WIDE: KENBURNS_STILL when static/low, else CAPTION_DOMINANT", () => {
    expect(selectTreatment("WIDE", "9:16", null, "static", false, ALL).treatment).toBe("KENBURNS_STILL");
    expect(selectTreatment("WIDE", "9:16", null, "low", false, ALL).treatment).toBe("KENBURNS_STILL");
    expect(selectTreatment("WIDE", "9:16", null, "high", false, ALL).treatment).toBe("CAPTION_DOMINANT");
  });

  it("9:16 ACTION: STACKED if motion high, else TRACKED_CROP", () => {
    expect(selectTreatment("ACTION", "9:16", 0.2, "high", false, ALL).treatment).toBe("STACKED");
    expect(selectTreatment("ACTION", "9:16", 0.2, "medium", false, ALL).treatment).toBe("TRACKED_CROP");
  });

  it("TWO_SHOT at 9:16 is never a cropping treatment, whatever the policy", () => {
    for (const policy of [ALL, ["TRACKED_CROP", "STACKED"] as Treatment[], ["TRACKED_CROP"] as Treatment[]]) {
      const t = selectTreatment("TWO_SHOT", "9:16", 0.1, "low", false, policy).treatment;
      expect(["CAPTION_DOMINANT", "STACKED"]).toContain(t);
    }
  });

  it("composition-first forces the chosen composition on every beat", () => {
    for (const shot of ShotType.options) {
      expect(selectTreatment(shot, "9:16", 0.1, "low", true, ALL, "CAPTION_DOMINANT").treatment).toBe("CAPTION_DOMINANT");
      expect(selectTreatment(shot, "1:1", 0.1, "low", true, ALL, "STACKED").treatment).toBe("STACKED");
    }
  });

  it("falls back to an allowed treatment when the policy excludes the matrix choice", () => {
    const r = selectTreatment("CU", "9:16", 0.1, "low", false, ["STATIC_CROP", "CAPTION_DOMINANT"]);
    expect(r.treatment).toBe("STATIC_CROP");
    expect(r.reason).toMatch(/not in format policy/);
  });

  it("every ratio × shot returns a treatment from the policy or CAPTION_DOMINANT", () => {
    for (const ratio of Ratio.options)
      for (const shot of ShotType.options)
        for (const motion of ["static", "low", "medium", "high"] as const) {
          const r = selectTreatment(shot, ratio, 0.2, motion, false, ALL);
          expect(ALL).toContain(r.treatment);
          expect(r.reason.length).toBeGreaterThan(5);
        }
  });
});

describe("treatmentViolations (D16)", () => {
  it("flags TRACKED_CROP on TWO_SHOT at 9:16", () => {
    expect(treatmentViolations([{ index: 0, treatment: "TRACKED_CROP", shots: ["TWO_SHOT"] }], "9:16")).toHaveLength(1);
    expect(treatmentViolations([{ index: 0, treatment: "CAPTION_DOMINANT", shots: ["TWO_SHOT"] }], "9:16")).toHaveLength(0);
  });
  it("flags non-NATIVE at 16:9", () => {
    expect(treatmentViolations([{ index: 0, treatment: "TRACKED_CROP", shots: ["CU"] }], "16:9")).toHaveLength(1);
  });
});

describe("frameBudget (§19.2)", () => {
  const ev = (c916: boolean, c11: boolean) => ({ croppable_916: c916, croppable_11: c11, usable: true });
  it("16:9 is always 100% native", () => {
    expect(frameBudget([ev(false, false)], "16:9", "CAPTION_DOMINANT")).toEqual({
      croppable_fraction: 1,
      composition_first: false,
      chosen_composition: null,
    });
  });
  it("composition_first when < 60% croppable", () => {
    const fb = frameBudget([ev(true, true), ev(false, true), ev(false, true), ev(false, true), ev(true, true)], "9:16", "CAPTION_DOMINANT");
    expect(fb.croppable_fraction).toBeCloseTo(0.4);
    expect(fb.composition_first).toBe(true);
    expect(fb.chosen_composition).toBe("CAPTION_DOMINANT");
  });
  it("not composition_first at 60%", () => {
    const fb = frameBudget([ev(true, true), ev(true, true), ev(true, true), ev(false, true), ev(false, true)], "9:16", "CAPTION_DOMINANT");
    expect(fb.composition_first).toBe(false);
    expect(fb.chosen_composition).toBeNull();
  });
});
