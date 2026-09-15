import { describe, expect, it } from "vitest";
import { CANVAS, CAPTION_DOMINANT, STACKED, SAFE_AREA, safeBox, boxInside, boxInsideCanvas, centredCrop, Ratio, WIDTH_RETENTION, MASTER_CROP_WINDOW } from "@/domain";

describe("safe-area geometry per ratio (§19.5)", () => {
  it("9:16 reserves 220 top and 346 bottom", () => {
    expect(SAFE_AREA["9:16"]).toEqual({ top: 220, bottom: 346, sides: 60 });
    expect(safeBox("9:16")).toEqual({ x: 60, y: 220, w: 960, h: 1920 - 220 - 346 });
  });
  it("safe boxes are inside their canvases", () => {
    for (const r of Ratio.options) expect(boxInsideCanvas(safeBox(r), r)).toBe(true);
  });
  it("CAPTION_DOMINANT 9:16 caption card sits fully inside the safe area", () => {
    expect(boxInside(CAPTION_DOMINANT["9:16"].caption, safeBox("9:16"))).toBe(true);
  });
  it("CAPTION_DOMINANT 9:16 source band is exactly 16:9 and uncropped", () => {
    const s = CAPTION_DOMINANT["9:16"].source;
    expect(s.w / s.h).toBeCloseTo(16 / 9, 2);
    expect(s).toEqual({ x: 0, y: 220, w: 1080, h: 608 });
  });
  it("STACKED 9:16 source band is exactly 16:9", () => {
    const s = STACKED["9:16"].source;
    expect(s.w / s.h).toBeCloseTo(16 / 9, 2);
    expect(s.y).toBe(960);
  });
  it("STACKED caption text box is inside the safe area at 9:16", () => {
    expect(boxInside(STACKED["9:16"].caption, safeBox("9:16"))).toBe(true);
    expect(CANVAS["9:16"].h - STACKED["9:16"].source.y - STACKED["9:16"].source.h).toBe(352);
  });
  it("every caption text box is inside its safe area", () => {
    for (const r of Ratio.options) {
      expect(boxInside(CAPTION_DOMINANT[r].caption, safeBox(r))).toBe(true);
      expect(boxInside(STACKED[r].caption, safeBox(r))).toBe(true);
    }
  });
  it("all layouts are inside their canvases", () => {
    for (const r of Ratio.options) {
      const cd = CAPTION_DOMINANT[r];
      expect(boxInsideCanvas(cd.source, r)).toBe(true);
      expect(boxInsideCanvas(cd.caption, r)).toBe(true);
      if (cd.breathing) expect(boxInsideCanvas(cd.breathing, r)).toBe(true);
      const st = STACKED[r];
      expect(boxInsideCanvas(st.presenter, r)).toBe(true);
      expect(boxInsideCanvas(st.source, r)).toBe(true);
      expect(boxInsideCanvas(st.caption, r)).toBe(true);
    }
  });
});

describe("the arithmetic that drives everything (§19.1)", () => {
  it("width retention matches the crop windows", () => {
    expect(MASTER_CROP_WINDOW["9:16"]).toEqual({ w: 608, h: 1080 });
    // 0.31640625 = (9/16)²; the 608px window is the even-pixel rounding of 607.5
    expect(WIDTH_RETENTION["9:16"]).toBeCloseTo(608 / 1920, 3);
    expect(WIDTH_RETENTION["1:1"]).toBeCloseTo(1080 / 1920, 4);
  });
  it("centredCrop clamps to the master", () => {
    expect(centredCrop("9:16", 0.0, 0.5)).toEqual({ x: 0, y: 0, w: 608, h: 1080 });
    expect(centredCrop("9:16", 1.0, 0.5)).toEqual({ x: 1920 - 608, y: 0, w: 608, h: 1080 });
    expect(centredCrop("9:16", 0.5, 0.5)).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
    expect(centredCrop("1:1", 0.3, 0.5)).toEqual({ x: 36, y: 0, w: 1080, h: 1080 });
  });
  it("a two-shot at x≈0.30 and x≈0.70 cannot fit a 608px window", () => {
    const left = 0.3 * 1920;
    const right = 0.7 * 1920;
    expect(right - left).toBeGreaterThan(608);
  });
});
