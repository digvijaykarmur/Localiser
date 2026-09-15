import { describe, expect, it } from "vitest";
import { computeCroppable, ShotType, type SubjectBox } from "@/domain";

const box = (w: number, extra: Partial<SubjectBox> = {}): SubjectBox => ({
  x: 0.5 - w / 2,
  y: 0.2,
  w,
  h: 0.5,
  is_speaking: false,
  label: "person",
  ...extra,
});

describe("computeCroppable — all 9 shot types × 3 ratios", () => {
  for (const shot of ShotType.options) {
    it(`${shot}: single narrow subject, low motion → croppable at 1:1 and 9:16`, () => {
      const r = computeCroppable({ usable: true, subject_count: 1, shot_type: shot, subject_boxes: [box(0.2)], motion: "low" });
      expect(r.croppable_11).toBe(true);
      expect(r.croppable_916).toBe(true);
      expect(r.crop_note).toBeNull();
    });

    it(`${shot}: two subjects → never croppable`, () => {
      const r = computeCroppable({
        usable: true,
        subject_count: 2,
        shot_type: shot,
        subject_boxes: [box(0.2, { x: 0.2 }), box(0.2, { x: 0.6 })],
        motion: "low",
      });
      expect(r.croppable_11).toBe(false);
      expect(r.croppable_916).toBe(false);
      expect(r.crop_note).toMatch(/2 subjects cannot share a 31% window/);
    });

    it(`${shot}: unusable → not croppable`, () => {
      const r = computeCroppable({ usable: false, subject_count: 1, shot_type: shot, subject_boxes: [box(0.2)], motion: "low" });
      expect(r).toEqual({ croppable_11: false, croppable_916: false, crop_note: "unusable" });
    });
  }

  it("subject width 0.4 fits a 1:1 window (0.5625×0.85=0.478) but not 9:16 (0.316×0.85=0.269)", () => {
    const r = computeCroppable({ usable: true, subject_count: 1, shot_type: "MS", subject_boxes: [box(0.4)], motion: "low" });
    expect(r.croppable_11).toBe(true);
    expect(r.croppable_916).toBe(false);
    expect(r.crop_note).toMatch(/subject width 0.40 exceeds window/);
  });

  it("high motion single subject → not croppable at either", () => {
    const r = computeCroppable({ usable: true, subject_count: 1, shot_type: "ACTION", subject_boxes: [box(0.2)], motion: "high" });
    expect(r.croppable_11).toBe(false);
    expect(r.croppable_916).toBe(false);
    expect(r.crop_note).toBe("high motion: tracking would judder");
  });

  it("WIDE with no subject → nothing to centre on", () => {
    const r = computeCroppable({ usable: true, subject_count: 0, shot_type: "WIDE", subject_boxes: [], motion: "static" });
    expect(r.croppable_916).toBe(false);
    expect(r.crop_note).toBe("wide with no subject: nothing to centre on");
  });

  it("INSERT with no subject → croppable (centre crop is fine)", () => {
    const r = computeCroppable({ usable: true, subject_count: 0, shot_type: "INSERT", subject_boxes: [], motion: "static" });
    expect(r.croppable_11).toBe(true);
    expect(r.croppable_916).toBe(true);
  });

  it("subject_count 1 but no box → defensive failure", () => {
    const r = computeCroppable({ usable: true, subject_count: 1, shot_type: "CU", subject_boxes: [], motion: "low" });
    expect(r.croppable_916).toBe(false);
    expect(r.crop_note).toBe("subject count > 0 but no box");
  });

  it("crop_note prefers the 9:16 reason over the 1:1 reason", () => {
    const r = computeCroppable({ usable: true, subject_count: 1, shot_type: "MS", subject_boxes: [box(0.3)], motion: "low" });
    expect(r.croppable_11).toBe(true);
    expect(r.croppable_916).toBe(false);
    expect(r.crop_note).toContain("0.30");
  });
});
