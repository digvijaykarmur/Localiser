import { describe, expect, it } from "vitest";
import { applyCroppable, type EvidenceUnit, type ShotType } from "@/domain";

const SHOTS: ShotType[] = ["ECU", "CU", "MCU", "MS", "TWO_SHOT", "GROUP", "WIDE", "INSERT", "ACTION"];

function unit(partial: Partial<EvidenceUnit> & Pick<EvidenceUnit, "shot_type">): EvidenceUnit {
  return applyCroppable({
    id: "ev_x",
    title_id: "t",
    start_ms: 0,
    end_ms: 2000,
    description: "x",
    subject_count: partial.subject_count ?? 1,
    subject_boxes: partial.subject_boxes ?? [
      { x: 0.4, y: 0.2, w: 0.18, h: 0.4, is_speaking: true, label: "s" },
    ],
    motion: partial.motion ?? "low",
    emotion: [],
    intensity: 5,
    has_dialogue: false,
    dialogue_native: null,
    dialogue_translit: null,
    is_spoiler: false,
    usable: true,
    unusable_reason: null,
    croppable_11: false,
    croppable_916: false,
    crop_note: null,
    ...partial,
  });
}

describe("computeCroppable", () => {
  it("covers nine shot types × both crop ratios", () => {
    const results: Record<string, { croppable_11: boolean; croppable_916: boolean }> = {};
    for (const shot of SHOTS) {
      const u = unit({
        shot_type: shot,
        subject_count: shot === "INSERT" ? 0 : shot === "TWO_SHOT" || shot === "GROUP" || shot === "WIDE" ? 2 : 1,
        subject_boxes:
          shot === "INSERT"
            ? []
            : shot === "TWO_SHOT" || shot === "GROUP"
              ? [
                  { x: 0.2, y: 0.2, w: 0.2, h: 0.4, is_speaking: true, label: "a" },
                  { x: 0.6, y: 0.2, w: 0.2, h: 0.4, is_speaking: false, label: "b" },
                ]
              : [{ x: 0.4, y: 0.2, w: 0.18, h: 0.4, is_speaking: true, label: "s" }],
        motion: shot === "ACTION" ? "high" : "low",
      });
      results[shot] = { croppable_11: u.croppable_11, croppable_916: u.croppable_916 };
    }
    expect(results.ECU?.croppable_916).toBe(true);
    expect(results.CU?.croppable_916).toBe(true);
    expect(results.MCU?.croppable_916).toBe(true);
    expect(results.MS?.croppable_916).toBe(true);
    expect(results.TWO_SHOT?.croppable_11).toBe(false);
    expect(results.TWO_SHOT?.croppable_916).toBe(false);
    expect(results.GROUP?.croppable_11).toBe(false);
    expect(results.GROUP?.croppable_916).toBe(false);
    expect(results.WIDE?.croppable_11).toBe(false);
    expect(results.INSERT?.croppable_11).toBe(true);
    expect(results.INSERT?.croppable_916).toBe(true);
    expect(results.ACTION?.croppable_11).toBe(false);
    expect(results.ACTION?.croppable_916).toBe(false);
  });

  it("refuses a subject wider than the crop window", () => {
    const u = unit({
      shot_type: "MS",
      subject_count: 1,
      subject_boxes: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.8, is_speaking: true, label: "wide subject" }],
    });
    expect(u.croppable_916).toBe(false);
  });
});
