import { z } from "zod";

export const ShotType = z.enum([
  "ECU",
  "CU",
  "MCU",
  "MS",
  "TWO_SHOT",
  "GROUP",
  "WIDE",
  "INSERT",
  "ACTION",
]);
export type ShotType = z.infer<typeof ShotType>;

export const Motion = z.enum(["static", "low", "medium", "high"]);
export type Motion = z.infer<typeof Motion>;

export const SubjectBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  is_speaking: z.boolean(),
  label: z.string(),
});
export type SubjectBox = z.infer<typeof SubjectBox>;

export const EvidenceUnit = z.object({
  id: z.string(),
  title_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),

  description: z.string().max(400),
  shot_type: ShotType,
  subject_count: z.number().int().nonnegative(),
  subject_boxes: z.array(SubjectBox),
  motion: Motion,
  emotion: z.array(z.string()).max(3),
  intensity: z.number().int().min(1).max(10),
  has_dialogue: z.boolean(),
  dialogue_native: z.string().nullable(),
  dialogue_translit: z.string().nullable(),
  is_spoiler: z.boolean(),
  usable: z.boolean(),
  unusable_reason: z.string().nullable(),

  croppable_11: z.boolean(),
  croppable_916: z.boolean(),
  crop_note: z.string().nullable(),
});
export type EvidenceUnit = z.infer<typeof EvidenceUnit>;

export function computeCroppable(u: EvidenceUnit): {
  croppable_11: boolean;
  croppable_916: boolean;
} {
  const usable = { "1:1": 0.5625, "9:16": 0.3164 };
  const check = (frac: number) => {
    if (u.subject_count === 0) return u.shot_type !== "WIDE";
    if (u.subject_count > 1) return false;
    const b = u.subject_boxes[0];
    if (!b) return false;
    if (b.w > frac * 0.85) return false;
    if (u.motion === "high") return false;
    return true;
  };
  return { croppable_11: check(usable["1:1"]), croppable_916: check(usable["9:16"]) };
}

export function applyCroppable(u: Omit<EvidenceUnit, "croppable_11" | "croppable_916"> & Partial<Pick<EvidenceUnit, "croppable_11" | "croppable_916">>): EvidenceUnit {
  const parsed = EvidenceUnit.parse({
    ...u,
    croppable_11: u.croppable_11 ?? false,
    croppable_916: u.croppable_916 ?? false,
  });
  const flags = computeCroppable(parsed);
  return EvidenceUnit.parse({ ...parsed, ...flags });
}

export function ratioCropKey(ratio: "16:9" | "9:16" | "1:1"): "croppable_11" | "croppable_916" | null {
  if (ratio === "1:1") return "croppable_11";
  if (ratio === "9:16") return "croppable_916";
  return null;
}

export function croppableFraction(
  evidence: EvidenceUnit[],
  ratio: "16:9" | "9:16" | "1:1",
): number {
  if (evidence.length === 0) return 0;
  if (ratio === "16:9") return 1;
  const key = ratioCropKey(ratio);
  if (!key) return 1;
  return evidence.filter((e) => e[key]).length / evidence.length;
}
