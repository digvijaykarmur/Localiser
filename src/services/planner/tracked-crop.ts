import type { Box, CropKeyframe, EvidenceUnit } from "@/domain";
import { CROP_WINDOW_ON_MASTER, CROP_VELOCITY_MAX_FRAC_PER_SEC, MASTER_WIDTH } from "@/domain";
import type { Ratio } from "@/domain";

const TAU_MS = 500;

export function cropWindowForRatio(ratio: Ratio): { w: number; h: number } {
  const w = CROP_WINDOW_ON_MASTER[ratio];
  return { w: w.width, h: w.height };
}

export function staticCropBox(u: EvidenceUnit, ratio: Ratio): Box | null {
  if (ratio === "16:9") return { x: 0, y: 0, w: 1920, h: 1080 };
  const win = cropWindowForRatio(ratio);
  const speaker = u.subject_boxes.find((b) => b.is_speaking) ?? u.subject_boxes[0];
  if (!speaker) {
    return {
      x: Math.round((1920 - win.w) / 2),
      y: Math.round((1080 - win.h) / 2),
      w: win.w,
      h: win.h,
    };
  }
  const cx = (speaker.x + speaker.w / 2) * 1920;
  const cy = (speaker.y + speaker.h / 2) * 1080;
  let x = Math.round(cx - win.w / 2);
  let y = Math.round(cy - win.h / 2);
  x = Math.min(Math.max(0, x), 1920 - win.w);
  y = Math.min(Math.max(0, y), 1080 - win.h);
  return { x, y, w: win.w, h: win.h };
}

/**
 * Piecewise-linear path through subject centroids, critically damped,
 * velocity-clamped. Returns null if required velocity exceeds 8%/s.
 */
export function buildTrackedCrop(
  u: EvidenceUnit,
  ratio: Ratio,
): { keyframes: CropKeyframe[]; note: string | null } | { uncroppable: true; note: string } {
  const base = staticCropBox(u, ratio);
  if (!base) return { uncroppable: true, note: "no crop box" };

  const duration = Math.max(1, u.end_ms - u.start_ms);
  const samples: { t_ms: number; cx: number; cy: number }[] = [];
  const step = 250;
  const boxes = u.subject_boxes;
  const primary = boxes.find((b) => b.is_speaking) ?? boxes[0];
  if (!primary) {
    return {
      keyframes: [
        { t_ms: 0, box: base },
        { t_ms: duration, box: base },
      ],
      note: null,
    };
  }

  for (let t = 0; t <= duration; t += step) {
    samples.push({
      t_ms: t,
      cx: (primary.x + primary.w / 2) * 1920,
      cy: (primary.y + primary.h / 2) * 1080,
    });
  }

  const smoothed: { t_ms: number; cx: number; cy: number }[] = [];
  let sx = samples[0]?.cx ?? 960;
  let sy = samples[0]?.cy ?? 540;
  const alpha = 1 - Math.exp(-step / TAU_MS);
  for (const s of samples) {
    sx = sx + alpha * (s.cx - sx);
    sy = sy + alpha * (s.cy - sy);
    smoothed.push({ t_ms: s.t_ms, cx: sx, cy: sy });
  }

  const maxPxPerMs = (CROP_VELOCITY_MAX_FRAC_PER_SEC * MASTER_WIDTH) / 1000;
  for (let i = 1; i < smoothed.length; i++) {
    const a = smoothed[i - 1]!;
    const b = smoothed[i]!;
    const dt = Math.max(1, b.t_ms - a.t_ms);
    const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
    if (dist / dt > maxPxPerMs) {
      return {
        uncroppable: true,
        note: "required crop velocity exceeds 8% frame width per second",
      };
    }
  }

  const win = cropWindowForRatio(ratio);
  const keyframes: CropKeyframe[] = smoothed
    .filter((_, i) => i === 0 || i === smoothed.length - 1 || i % 4 === 0)
    .map((s) => {
      let x = Math.round(s.cx - win.w / 2);
      let y = Math.round(s.cy - win.h / 2);
      x = Math.min(Math.max(0, x), 1920 - win.w);
      y = Math.min(Math.max(0, y), 1080 - win.h);
      return { t_ms: s.t_ms, box: { x, y, w: win.w, h: win.h } };
    });

  return { keyframes, note: null };
}

export function maxCropVelocityFracPerSec(keyframes: CropKeyframe[]): number {
  let max = 0;
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1]!;
    const b = keyframes[i]!;
    const dt = (b.t_ms - a.t_ms) / 1000;
    if (dt <= 0) continue;
    const dx = Math.abs(b.box.x - a.box.x);
    max = Math.max(max, dx / MASTER_WIDTH / dt);
  }
  return max;
}
