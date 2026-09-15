import type { Motion, ShotType } from "./evidence";
import type { Treatment } from "./plan";
import type { Ratio } from "./primitives";

/**
 * TRC treatment matrix (§19.3) — a pure function, never a model decision.
 * The model proposes structure; this decides composition.
 */
export function selectTreatment(
  shot: ShotType,
  ratio: Ratio,
  subjectW: number | null,
  motion: Motion,
  compositionFirst: boolean,
  policy: Treatment[],
  chosenComposition: Treatment | null = null,
): { treatment: Treatment; reason: string } {
  const allow = (t: Treatment, reason: string, ...fallbacks: Treatment[]) => {
    if (policy.includes(t)) return { treatment: t, reason };
    for (const f of fallbacks) if (policy.includes(f)) return { treatment: f, reason: `${reason}; ${t} not in format policy → ${f}` };
    // last resort: the format's own composition (Split UGC only composes as STACKED)
    const comp = policy.find((p) => COMPOSITION_TREATMENTS.has(p)) ?? "CAPTION_DOMINANT";
    return { treatment: comp, reason: `${reason}; no allowed treatment → ${comp}` };
  };

  if (ratio === "16:9") return allow("NATIVE", "16:9 is the master ratio; nothing to crop");

  if (compositionFirst) {
    const comp = chosenComposition ?? "CAPTION_DOMINANT";
    return allow(comp, `composition-first: <60% of evidence croppable at ${ratio}; one composition for the whole promo`, "CAPTION_DOMINANT", "STACKED");
  }

  const is916 = ratio === "9:16";

  switch (shot) {
    case "ECU":
    case "CU":
    case "MCU":
    case "INSERT":
      return allow("TRACKED_CROP", `${shot}: single tight subject survives a ${is916 ? "31.6%" : "56%"} window`, "STATIC_CROP", "CAPTION_DOMINANT");
    case "MS":
      if (!is916) return allow("TRACKED_CROP", "MS at 1:1: waist-up subject fits a 56% window", "STATIC_CROP", "CAPTION_DOMINANT");
      if (subjectW !== null && subjectW < 0.27)
        return allow("TRACKED_CROP", `MS at 9:16: subject width ${subjectW.toFixed(2)} < 0.27 fits the 31.6% window`, "STATIC_CROP", "CAPTION_DOMINANT");
      return allow("CAPTION_DOMINANT", `MS at 9:16: subject width ${subjectW === null ? "unknown" : subjectW.toFixed(2)} ≥ 0.27 would be cut → compose`, "STACKED");
    case "TWO_SHOT":
      if (!is916) return allow("SPEAKER_CUT", "TWO_SHOT at 1:1: hold on the speaker, hard-cut on speaker change — never pan", "CAPTION_DOMINANT", "STACKED");
      return allow("CAPTION_DOMINANT", "TWO_SHOT at 9:16: both faces cannot share a 608px window — never crop", "STACKED");
    case "GROUP":
      return allow("CAPTION_DOMINANT", `GROUP at ${ratio}: three or more subjects cannot be cropped`, "STACKED");
    case "WIDE":
      if (is916 && (motion === "static" || motion === "low"))
        return allow("KENBURNS_STILL", "WIDE at 9:16 with low motion: a slow push on a still reads as intent", "CAPTION_DOMINANT", "STACKED");
      return allow("CAPTION_DOMINANT", `WIDE at ${ratio}: figures small or absent; show the whole frame`, "STACKED");
    case "ACTION":
      if (!is916) return allow("TRACKED_CROP", "ACTION at 1:1: tracked crop with lead-room", "STATIC_CROP", "CAPTION_DOMINANT");
      if (motion === "high") return allow("STACKED", "ACTION at 9:16 with high motion: tracking would judder → stacked", "CAPTION_DOMINANT");
      return allow("TRACKED_CROP", "ACTION at 9:16 with moderate motion: tracked crop", "STATIC_CROP", "CAPTION_DOMINANT");
  }
}

/** Treatments that crop the source at all (D16 forbids TRACKED_CROP on TWO_SHOT at 9:16). */
export const CROPPING_TREATMENTS: ReadonlySet<Treatment> = new Set(["TRACKED_CROP", "STATIC_CROP", "SPEAKER_CUT"]);

/** Treatments that show the whole 16:9 frame inside a composition. */
export const COMPOSITION_TREATMENTS: ReadonlySet<Treatment> = new Set(["CAPTION_DOMINANT", "STACKED", "INSET"]);

/** Frame Budget (§19.2). */
export function frameBudget(
  evidence: { croppable_916: boolean; croppable_11: boolean; usable: boolean }[],
  ratio: Ratio,
  compositionDefault: Treatment,
): { croppable_fraction: number; composition_first: boolean; chosen_composition: Treatment | null } {
  const usable = evidence.filter((e) => e.usable);
  if (ratio === "16:9") return { croppable_fraction: 1, composition_first: false, chosen_composition: null };
  if (usable.length === 0) return { croppable_fraction: 0, composition_first: true, chosen_composition: compositionDefault };
  const key = ratio === "9:16" ? "croppable_916" : "croppable_11";
  const fraction = usable.filter((e) => e[key]).length / usable.length;
  const compositionFirst = fraction < 0.6;
  return {
    croppable_fraction: fraction,
    composition_first: compositionFirst,
    chosen_composition: compositionFirst ? compositionDefault : null,
  };
}

/**
 * D16: treatment matrix respected. Returns violations. The hard rule: TWO_SHOT and GROUP
 * must never be cropped at 9:16; nothing is cropped at 16:9.
 */
export function treatmentViolations(
  beats: { index: number; treatment: Treatment; shots: ShotType[] }[],
  ratio: Ratio,
): string[] {
  const out: string[] = [];
  for (const b of beats) {
    if (ratio === "16:9" && b.treatment !== "NATIVE" && b.treatment !== "GENERATED_NATIVE" && b.treatment !== "STACKED")
      out.push(`beat ${b.index}: ${b.treatment} at 16:9 (must be NATIVE)`);
    if (ratio === "9:16" && CROPPING_TREATMENTS.has(b.treatment) && b.shots.some((s) => s === "TWO_SHOT" || s === "GROUP"))
      out.push(`beat ${b.index}: ${b.treatment} on ${b.shots.join("/")} at 9:16`);
    if (ratio === "1:1" && (b.treatment === "TRACKED_CROP" || b.treatment === "STATIC_CROP") && b.shots.some((s) => s === "GROUP"))
      out.push(`beat ${b.index}: ${b.treatment} on GROUP at 1:1`);
  }
  return out;
}
