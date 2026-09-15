import { CANVAS, MASTER, type Ratio } from "./primitives";
import type { Box } from "./timeline";

/** Safe areas (§19.5) — enforced, not eyeballed. */
export const SAFE_AREA: Record<Ratio, { top: number; bottom: number; sides: number }> = {
  "9:16": { top: 220, bottom: 346, sides: 60 },
  "1:1": { top: 60, bottom: 160, sides: 60 },
  "16:9": { top: 54, bottom: 108, sides: 96 },
};

export function safeBox(ratio: Ratio): Box {
  const c = CANVAS[ratio];
  const s = SAFE_AREA[ratio];
  return { x: s.sides, y: s.top, w: c.w - 2 * s.sides, h: c.h - s.top - s.bottom };
}

export function boxInside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function boxInsideCanvas(b: Box, ratio: Ratio): boolean {
  const c = CANVAS[ratio];
  return boxInside(b, { x: 0, y: 0, w: c.w, h: c.h });
}

/** Composition geometry — constants, not computed (§19.4). */
export interface CaptionDominantLayout {
  source: Box;
  caption: Box;
  breathing: Box | null;
}

// Caption card boxes are the *text* boxes (D8 checks them against the safe area), so they are
// inset by the side safe margin; the band behind them is the canvas background.
export const CAPTION_DOMINANT: Record<Ratio, CaptionDominantLayout> = {
  "9:16": {
    source: { x: 0, y: 220, w: 1080, h: 608 },
    caption: { x: 60, y: 828, w: 960, h: 560 },
    breathing: { x: 0, y: 1388, w: 1080, h: 186 },
  },
  "1:1": {
    source: { x: 0, y: 120, w: 1080, h: 608 },
    caption: { x: 60, y: 728, w: 960, h: 192 },
    breathing: null,
  },
  // 16:9 is always NATIVE; captions overlay the lower safe band.
  "16:9": {
    source: { x: 0, y: 0, w: 1920, h: 1080 },
    caption: { x: 96, y: 780, w: 1728, h: 192 },
    breathing: null,
  },
};

export interface StackedLayout {
  presenter: Box;
  source: Box;
  caption: Box;
}

// STACKED 9:16: presenter 0–960, source 960–1568, caption band 1568–1920 (§19.4). The band
// overlaps the 346px bottom reserve, so the caption *text* box is the 6px sliver above the
// reserve plus... nothing usable. The text therefore sits over the lower part of the presenter
// band (inside the safe area) and the 1568–1920 band carries the logo/breathing room only.
export const STACKED: Record<Ratio, StackedLayout> = {
  "9:16": {
    presenter: { x: 0, y: 0, w: 1080, h: 960 },
    source: { x: 0, y: 960, w: 1080, h: 608 },
    caption: { x: 60, y: 760, w: 960, h: 180 },
  },
  "1:1": {
    presenter: { x: 0, y: 0, w: 1080, h: 412 },
    source: { x: 0, y: 412, w: 1080, h: 608 },
    caption: { x: 60, y: 60, w: 960, h: 100 },
  },
  "16:9": {
    presenter: { x: 0, y: 0, w: 640, h: 1080 },
    source: { x: 640, y: 180, w: 1280, h: 720 },
    caption: { x: 736, y: 900, w: 1088, h: 72 },
  },
};

/** Full-canvas box for NATIVE / TRACKED_CROP / STATIC_CROP treatments. */
export function fullCanvas(ratio: Ratio): Box {
  const c = CANVAS[ratio];
  return { x: 0, y: 0, w: c.w, h: c.h };
}

/** CTA card fills the canvas; text placement inside is the designed PNG's job. */
export function ctaBox(ratio: Ratio): Box {
  return fullCanvas(ratio);
}

/** Caption overlay box for a NATIVE 16:9 beat, inside the safe area. */
export function nativeCaptionBox(ratio: Ratio): Box {
  return CAPTION_DOMINANT[ratio].caption;
}

/** Master-space crop window centred on a normalised subject centre, clamped to the master. */
export function centredCrop(ratio: Ratio, cx: number, cy: number): Box {
  const win = { "16:9": { w: 1920, h: 1080 }, "1:1": { w: 1080, h: 1080 }, "9:16": { w: 608, h: 1080 } }[ratio];
  const x = clamp(Math.round(cx * MASTER.w - win.w / 2), 0, MASTER.w - win.w);
  const y = clamp(Math.round(cy * MASTER.h - win.h / 2), 0, MASTER.h - win.h);
  return { x, y, w: win.w, h: win.h };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** KENBURNS_STILL: a 16:9 still scaled to canvas height, cropped on subject centroid. */
export function kenBurnsSource(ratio: Ratio, cx: number, zoom: number): Box {
  const c = CANVAS[ratio];
  // scale master to canvas height → width becomes MASTER.w * (c.h/MASTER.h); we express crop in master space.
  const winW = Math.round((c.w * MASTER.h) / c.h / zoom);
  const winH = Math.round(MASTER.h / zoom);
  const x = clamp(Math.round(cx * MASTER.w - winW / 2), 0, MASTER.w - winW);
  const y = clamp(Math.round(MASTER.h / 2 - winH / 2), 0, MASTER.h - winH);
  return { x, y, w: winW, h: winH };
}
