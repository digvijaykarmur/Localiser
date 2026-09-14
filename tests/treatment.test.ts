import { describe, expect, it } from "vitest";
import { selectTreatment } from "@/domain";

describe("treatment matrix", () => {
  it("never crops a two-shot at 9:16", () => {
    const r = selectTreatment({
      shotType: "TWO_SHOT",
      ratio: "9:16",
      formatPolicy: ["TRACKED_CROP", "CAPTION_DOMINANT", "STACKED"],
      compositionFirst: false,
    });
    expect(["CAPTION_DOMINANT", "STACKED"]).toContain(r.treatment);
    expect(r.treatment).not.toBe("TRACKED_CROP");
  });

  it("uses composition-first for the whole ratio when budget fails", () => {
    const r = selectTreatment({
      shotType: "CU",
      ratio: "9:16",
      formatPolicy: ["TRACKED_CROP", "CAPTION_DOMINANT", "STACKED"],
      compositionFirst: true,
    });
    expect(["CAPTION_DOMINANT", "STACKED"]).toContain(r.treatment);
  });
});
