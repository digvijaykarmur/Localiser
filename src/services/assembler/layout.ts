import type { Box, EvidenceUnit, Ratio, Treatment } from "@/domain";
import {
  CAPTION_DOMINANT_11,
  CAPTION_DOMINANT_169,
  CAPTION_DOMINANT_916,
  INSET_169,
  RATIO_CANVAS,
  STACKED_11,
  STACKED_916,
} from "@/domain";
import { staticCropBox } from "@/services/planner/tracked-crop";

export function sourceDest(treatment: Treatment, ratio: Ratio): Box {
  if (treatment === "NATIVE") {
    const c = RATIO_CANVAS[ratio];
    return { x: 0, y: 0, w: c.width, h: c.height };
  }
  if (treatment === "TRACKED_CROP" || treatment === "STATIC_CROP" || treatment === "KENBURNS_STILL" || treatment === "GENERATED_NATIVE") {
    const c = RATIO_CANVAS[ratio];
    return { x: 0, y: 0, w: c.width, h: c.height };
  }
  if (treatment === "CAPTION_DOMINANT") {
    if (ratio === "9:16") return { ...CAPTION_DOMINANT_916.source };
    if (ratio === "1:1") return { ...CAPTION_DOMINANT_11.source };
    return { ...CAPTION_DOMINANT_169.source };
  }
  if (treatment === "STACKED") {
    if (ratio === "9:16") return { ...STACKED_916.source };
    if (ratio === "1:1") return { ...STACKED_11.source };
    return { x: 0, y: 0, w: 1280, h: 720 };
  }
  if (treatment === "INSET") {
    return { ...INSET_169.source };
  }
  const c = RATIO_CANVAS[ratio];
  return { x: 0, y: 0, w: c.width, h: c.height };
}

export function captionDest(ratio: Ratio): Box | null {
  if (ratio === "9:16") return { x: 60, y: 828, w: 960, h: 560 };
  if (ratio === "1:1") return { x: 60, y: 668, w: 960, h: 252 };
  return { x: 1280, y: 54, w: 544, h: 918 };
}

export function presenterDest(ratio: Ratio): Box {
  if (ratio === "9:16") return { ...STACKED_916.presenter };
  if (ratio === "1:1") return { ...STACKED_11.presenter };
  return { ...INSET_169.presenter };
}

export function compositionUsesWholeFrame(treatment: Treatment): boolean {
  return (
    treatment === "STACKED" ||
    treatment === "CAPTION_DOMINANT" ||
    treatment === "NATIVE" ||
    treatment === "INSET"
  );
}

export function kenburnsCrops(unit: EvidenceUnit, durationMs: number): { t_ms: number; box: Box }[] {
  const base = staticCropBox(unit, "9:16") ?? { x: 656, y: 0, w: 608, h: 1080 };
  const endW = Math.round(base.w / 1.08);
  const endH = Math.round(base.h / 1.08);
  const endX = base.x + Math.round((base.w - endW) / 2);
  const endY = base.y + Math.round((base.h - endH) / 2);
  return [
    { t_ms: 0, box: base },
    { t_ms: durationMs, box: { x: endX, y: endY, w: endW, h: endH } },
  ];
}
