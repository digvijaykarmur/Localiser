import { z } from "zod";
import { WIDTH_RETENTION } from "./primitives";

export const ShotType = z.enum(["ECU", "CU", "MCU", "MS", "TWO_SHOT", "GROUP", "WIDE", "INSERT", "ACTION"]);
export type ShotType = z.infer<typeof ShotType>;

export const Motion = z.enum(["static", "low", "medium", "high"]);
export type Motion = z.infer<typeof Motion>;

export const SubjectBox = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  is_speaking: z.boolean(),
  label: z.string().max(60),
});
export type SubjectBox = z.infer<typeof SubjectBox>;

/** What the vision model is asked to produce. Computed fields are added afterwards by code. */
export const EvidenceDescription = z.object({
  description: z.string().max(400),
  shot_type: ShotType,
  subject_count: z.number().int().nonnegative(),
  subject_boxes: z.array(SubjectBox).max(6),
  motion: Motion,
  emotion: z.array(z.string()).max(3),
  intensity: z.number().int().min(1).max(10),
  has_dialogue: z.boolean(),
  dialogue_native: z.string().nullable(),
  is_spoiler: z.boolean(),
  usable: z.boolean(),
  unusable_reason: z.string().nullable(),
});
export type EvidenceDescription = z.infer<typeof EvidenceDescription>;

export const EvidenceUnit = z.object({
  id: z.string(), // ev_<titleId>_<seq>, stable across rebuilds
  title_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
  frame_urls: z.array(z.string()).length(3),

  // --- model-described (vision) ---
  description: z.string().max(400),
  shot_type: ShotType,
  subject_count: z.number().int().nonnegative(),
  subject_boxes: z.array(SubjectBox).max(6),
  motion: Motion,
  emotion: z.array(z.string()).max(3),
  intensity: z.number().int().min(1).max(10),
  has_dialogue: z.boolean(),
  dialogue_native: z.string().nullable(),
  is_spoiler: z.boolean(),
  usable: z.boolean(),
  unusable_reason: z.string().nullable(),

  // --- computed, never asked of a model ---
  croppable_11: z.boolean(),
  croppable_916: z.boolean(),
  crop_note: z.string().nullable(),
});
export type EvidenceUnit = z.infer<typeof EvidenceUnit>;

export type EvidenceUncomputed = Omit<EvidenceUnit, "croppable_11" | "croppable_916" | "crop_note">;

export function evidenceId(titleId: string, seq: number): string {
  return `ev_${titleId}_${String(seq).padStart(4, "0")}`;
}

/**
 * Pass B of intelligence (§17.2). Pure. This is the most important twenty lines in the codebase:
 * it refuses to crop what cannot be cropped and forces composition instead.
 */
export function computeCroppable(
  u: Pick<EvidenceUncomputed, "usable" | "subject_count" | "shot_type" | "subject_boxes" | "motion">,
): Pick<EvidenceUnit, "croppable_11" | "croppable_916" | "crop_note"> {
  const check = (retention: number): { ok: boolean; note: string | null } => {
    if (!u.usable) return { ok: false, note: "unusable" };
    if (u.subject_count === 0)
      return u.shot_type === "WIDE"
        ? { ok: false, note: "wide with no subject: nothing to centre on" }
        : { ok: true, note: null };
    if (u.subject_count > 1)
      return { ok: false, note: `${u.subject_count} subjects cannot share a ${(retention * 100) | 0}% window` };
    const b = u.subject_boxes[0];
    if (!b) return { ok: false, note: "subject count > 0 but no box" };
    if (b.w > retention * 0.85) return { ok: false, note: `subject width ${b.w.toFixed(2)} exceeds window` };
    if (u.motion === "high") return { ok: false, note: "high motion: tracking would judder" };
    return { ok: true, note: null };
  };
  const c11 = check(WIDTH_RETENTION["1:1"]);
  const c916 = check(WIDTH_RETENTION["9:16"]);
  return {
    croppable_11: c11.ok,
    croppable_916: c916.ok,
    crop_note: c916.note ?? c11.note ?? null,
  };
}

export function withCroppability(u: EvidenceUncomputed): EvidenceUnit {
  return { ...u, ...computeCroppable(u) };
}
