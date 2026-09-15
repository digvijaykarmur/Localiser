import type { SubjectBox } from "./evidence";
import { centredCrop } from "./geometry";
import { MASTER, type Ratio } from "./primitives";
import type { CropKeyframe } from "./timeline";

/** Max crop-window velocity: 8% of master frame width per second (§19.6, D15). */
export const MAX_CROP_VELOCITY_FRAC_PER_S = 0.08;
export const CROP_SAMPLE_FPS = 4;
export const SMOOTHING_TAU_MS = 500;
export const MIN_DIRECTION_CHANGE_GAP_MS = 2000;

export interface CentroidSample {
  t_ms: number;
  cx: number; // normalised 0..1
  cy: number;
}

/** Centroid of a subject box (normalised). */
export function boxCentroid(b: Pick<SubjectBox, "x" | "y" | "w" | "h">): { cx: number; cy: number } {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/**
 * Critically damped first-order smoothing of a centroid path (§19.6 step 3).
 * Samples must be time-ordered.
 */
export function smoothPath(samples: CentroidSample[], tauMs = SMOOTHING_TAU_MS): CentroidSample[] {
  if (samples.length === 0) return [];
  const out: CentroidSample[] = [{ ...samples[0]! }];
  for (let i = 1; i < samples.length; i++) {
    const prev = out[i - 1]!;
    const s = samples[i]!;
    const dt = Math.max(1, s.t_ms - prev.t_ms);
    const a = 1 - Math.exp(-dt / tauMs);
    out.push({ t_ms: s.t_ms, cx: prev.cx + a * (s.cx - prev.cx), cy: prev.cy + a * (s.cy - prev.cy) });
  }
  return out;
}

/** Limit direction changes to at most one per 2 seconds by dropping short reversals. */
export function limitDirectionChanges(samples: CentroidSample[], gapMs = MIN_DIRECTION_CHANGE_GAP_MS): CentroidSample[] {
  if (samples.length < 3) return samples;
  const out: CentroidSample[] = [samples[0]!];
  let lastDir = 0;
  let lastChangeT = -Infinity;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    const prev = out[out.length - 1]!;
    const dir = Math.sign(s.cx - prev.cx);
    if (dir !== 0 && lastDir !== 0 && dir !== lastDir) {
      if (s.t_ms - lastChangeT < gapMs) {
        // hold position instead of reversing
        out.push({ t_ms: s.t_ms, cx: prev.cx, cy: prev.cy });
        continue;
      }
      lastChangeT = s.t_ms;
    }
    if (dir !== 0) lastDir = dir;
    out.push(s);
  }
  return out;
}

/** Peak velocity of a keyframe path as a fraction of master width per second. */
export function peakVelocityFrac(keyframes: CropKeyframe[]): number {
  let peak = 0;
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1]!;
    const b = keyframes[i]!;
    const dt = (b.t_ms - a.t_ms) / 1000;
    if (dt <= 0) continue;
    const dx = Math.abs(b.box.x - a.box.x) / MASTER.w;
    const dy = Math.abs(b.box.y - a.box.y) / MASTER.h;
    peak = Math.max(peak, Math.max(dx, dy) / dt);
  }
  return peak;
}

/**
 * Build explicit crop keyframes from centroid samples. Returns null when the required velocity
 * exceeds the limit — the caller must fall back to composition and record crop_note.
 */
export function planTrackedCrop(
  ratio: Ratio,
  samples: CentroidSample[],
): { keyframes: CropKeyframe[]; peak_velocity: number } | null {
  if (samples.length === 0) return null;
  const path = limitDirectionChanges(smoothPath(samples));
  const keyframes: CropKeyframe[] = path.map((s) => ({ t_ms: s.t_ms, box: centredCrop(ratio, s.cx, s.cy) }));
  // collapse consecutive identical boxes
  const collapsed: CropKeyframe[] = [];
  for (const k of keyframes) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.box.x === k.box.x && last.box.y === k.box.y && collapsed.length > 1) {
      const beforeLast = collapsed[collapsed.length - 2]!;
      if (beforeLast.box.x === k.box.x && beforeLast.box.y === k.box.y) {
        collapsed[collapsed.length - 1] = k; // extend the hold
        continue;
      }
    }
    collapsed.push(k);
  }
  const peak = peakVelocityFrac(collapsed);
  if (peak > MAX_CROP_VELOCITY_FRAC_PER_S) return null;
  return { keyframes: collapsed, peak_velocity: peak };
}

/**
 * Synthesise centroid samples for a beat from the evidence unit's subject box(es).
 * v1 evidence carries one box set per unit (not per frame), so the path is a hold at the
 * subject centroid; see OBJECTIONS.md. The sampling stays at 4fps so per-frame boxes can be
 * dropped in without changing the caller.
 */
export function samplesFromBoxes(boxes: SubjectBox[], durationMs: number, fps = CROP_SAMPLE_FPS): CentroidSample[] {
  const speaking = boxes.find((b) => b.is_speaking) ?? boxes[0];
  if (!speaking) return [];
  const { cx, cy } = boxCentroid(speaking);
  const step = Math.round(1000 / fps);
  const out: CentroidSample[] = [];
  for (let t = 0; t <= durationMs; t += step) out.push({ t_ms: t, cx, cy });
  if (out[out.length - 1]!.t_ms !== durationMs) out.push({ t_ms: durationMs, cx, cy });
  return out;
}
