import { FRAME_BUDGET_THRESHOLD } from "./codes";
import type { Ratio } from "./codes";
import type { ShotType } from "./evidence";
import type { EvidenceUnit } from "./evidence";
import { croppableFraction } from "./evidence";
import type { Treatment } from "./plan";

export function frameBudget(evidence: EvidenceUnit[], ratio: Ratio) {
  const frac = croppableFraction(evidence, ratio);
  return {
    croppable_fraction: frac,
    composition_first: frac < FRAME_BUDGET_THRESHOLD,
  };
}

const COMPOSITION_TREATMENTS: Treatment[] = [
  "CAPTION_DOMINANT",
  "STACKED",
  "INSET",
  "KENBURNS_STILL",
  "GENERATED_NATIVE",
];

export function pickCompositionTreatment(policy: Treatment[]): Treatment {
  const hit = policy.find((t) => COMPOSITION_TREATMENTS.includes(t));
  return hit ?? policy[0] ?? "CAPTION_DOMINANT";
}

export function selectTreatment(args: {
  shotType: ShotType;
  ratio: Ratio;
  formatPolicy: Treatment[];
  compositionFirst: boolean;
  subjectW?: number;
  motion?: EvidenceUnit["motion"];
}): { treatment: Treatment; reason: string } {
  const { shotType, ratio, formatPolicy, compositionFirst, subjectW, motion } = args;

  const allow = (t: Treatment, reason: string): { treatment: Treatment; reason: string } | null => {
    if (formatPolicy.includes(t)) return { treatment: t, reason };
    return null;
  };

  if (ratio === "16:9") {
    return (
      allow("NATIVE", "16:9 master used natively") ??
      allow(formatPolicy[0] ?? "NATIVE", "16:9 format policy fallback") ?? {
        treatment: "NATIVE",
        reason: "16:9 default native",
      }
    );
  }

  if (compositionFirst) {
    const t = pickCompositionTreatment(formatPolicy);
    return {
      treatment: t,
      reason: "frame budget composition-first; mix of crop and compose is forbidden",
    };
  }

  if (shotType === "TWO_SHOT") {
    if (ratio === "1:1") {
      return (
        allow("STATIC_CROP", "speaker-cut: static crop on speaking subject") ?? {
          treatment: pickCompositionTreatment(formatPolicy),
          reason: "two-shot speaker-cut not in policy; compose",
        }
      );
    }
    return {
      treatment: pickCompositionTreatment(formatPolicy),
      reason: "two-shot never cropped at 9:16",
    };
  }

  if (shotType === "GROUP") {
    return (
      allow("CAPTION_DOMINANT", "group cannot be cropped") ?? {
        treatment: pickCompositionTreatment(formatPolicy),
        reason: "group composition fallback",
      }
    );
  }

  if (shotType === "WIDE") {
    if (ratio === "9:16") {
      return (
        allow("KENBURNS_STILL", "wide at 9:16 is a still push, not a crop") ??
        allow("CAPTION_DOMINANT", "wide at 9:16 caption-dominant") ?? {
          treatment: pickCompositionTreatment(formatPolicy),
          reason: "wide composition fallback",
        }
      );
    }
    return (
      allow("CAPTION_DOMINANT", "wide at 1:1 caption-dominant") ?? {
        treatment: pickCompositionTreatment(formatPolicy),
        reason: "wide composition fallback",
      }
    );
  }

  if (shotType === "ACTION" && motion === "high" && ratio === "9:16") {
    return (
      allow("STACKED", "high-motion action stacked so source stays whole") ?? {
        treatment: pickCompositionTreatment(formatPolicy),
        reason: "high-motion action cannot be tracked",
      }
    );
  }

  if (shotType === "MS" && ratio === "9:16") {
    if (subjectW !== undefined && subjectW < 0.27) {
      return (
        allow("TRACKED_CROP", "MS subject narrower than 0.27 of master") ?? {
          treatment: pickCompositionTreatment(formatPolicy),
          reason: "MS tracked crop not in policy",
        }
      );
    }
    return (
      allow("CAPTION_DOMINANT", "MS subject too wide for 9:16 crop window") ?? {
        treatment: pickCompositionTreatment(formatPolicy),
        reason: "MS composition fallback",
      }
    );
  }

  const crop =
    allow("TRACKED_CROP", `${shotType} tracked crop at ${ratio}`) ??
    allow("STATIC_CROP", `${shotType} static crop at ${ratio}`);
  if (crop) return crop;

  return {
    treatment: pickCompositionTreatment(formatPolicy),
    reason: `${shotType} crop not in policy; compose`,
  };
}
