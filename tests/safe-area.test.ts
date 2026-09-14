import { describe, expect, it } from "vitest";
import { boxInside, safeRect, SAFE_AREA, RATIO_CANVAS, CTA_DEST } from "@/domain";
import { captionDest } from "@/services/assembler/layout";

describe("safe areas", () => {
  it("keeps CTA dest inside the safe rect for every ratio", () => {
    for (const ratio of ["16:9", "9:16", "1:1"] as const) {
      const canvas = RATIO_CANVAS[ratio];
      const safe = safeRect(ratio, canvas.width, canvas.height);
      expect(boxInside(CTA_DEST[ratio], safe)).toBe(true);
      const cap = captionDest(ratio);
      if (cap) expect(boxInside(cap, safe)).toBe(true);
    }
  });

  it("matches reserved pixels from the spec", () => {
    expect(SAFE_AREA["9:16"]).toEqual({ top: 220, bottom: 346, side: 60 });
    expect(SAFE_AREA["1:1"]).toEqual({ top: 60, bottom: 160, side: 60 });
    expect(SAFE_AREA["16:9"]).toEqual({ top: 54, bottom: 108, side: 96 });
  });
});
