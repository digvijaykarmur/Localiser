import type { Box } from "./timeline";
import type { Ratio } from "./codes";

/** Text/CTA/logo must lie entirely inside these boxes. */
export const SAFE_AREA: Record<
  Ratio,
  { top: number; bottom: number; side: number }
> = {
  "9:16": { top: 220, bottom: 346, side: 60 },
  "1:1": { top: 60, bottom: 160, side: 60 },
  "16:9": { top: 54, bottom: 108, side: 96 },
};

export function safeRect(ratio: Ratio, width: number, height: number): Box {
  const s = SAFE_AREA[ratio];
  return {
    x: s.side,
    y: s.top,
    w: width - s.side * 2,
    h: height - s.top - s.bottom,
  };
}

export function boxInside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** CAPTION_DOMINANT @ 9:16 — native 16:9 source, uncropped. */
export const CAPTION_DOMINANT_916 = {
  top_safe: { x: 0, y: 0, w: 1080, h: 220 },
  source: { x: 0, y: 220, w: 1080, h: 608 },
  caption: { x: 0, y: 828, w: 1080, h: 560 },
  breathing: { x: 0, y: 1388, w: 1080, h: 186 },
  bottom_safe: { x: 0, y: 1574, w: 1080, h: 346 },
} as const;

/** STACKED @ 9:16 — SU geometry (§6.3). Source band is exactly 16:9. */
export const STACKED_916 = {
  presenter: { x: 0, y: 0, w: 1080, h: 960 },
  source: { x: 0, y: 960, w: 1080, h: 608 },
  caption_band: { x: 0, y: 1568, w: 1080, h: 352 },
} as const;

export const STACKED_11 = {
  presenter: { x: 0, y: 0, w: 1080, h: 472 },
  source: { x: 0, y: 472, w: 1080, h: 608 },
} as const;

export const INSET_169 = {
  source: { x: 0, y: 0, w: 1920, h: 1080 },
  presenter: { x: 1400, y: 620, w: 460, h: 400 },
} as const;

export const CAPTION_DOMINANT_11 = {
  source: { x: 0, y: 60, w: 1080, h: 608 },
  caption: { x: 0, y: 668, w: 1080, h: 252 },
} as const;

export const CAPTION_DOMINANT_169 = {
  source: { x: 0, y: 0, w: 1280, h: 720 },
  caption: { x: 1280, y: 0, w: 640, h: 1080 },
} as const;

/** CTA card dest — always inside safe area, never model-authored. */
export const CTA_DEST: Record<Ratio, Box> = {
  "9:16": { x: 60, y: 1280, w: 960, h: 240 },
  "1:1": { x: 60, y: 780, w: 960, h: 120 },
  "16:9": { x: 96, y: 820, w: 1728, h: 152 },
};

export const SU_GEOMETRY = {
  "9:16": STACKED_916,
  "1:1": STACKED_11,
  "16:9": INSET_169,
} as const;
