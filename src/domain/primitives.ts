import { z } from "zod";

export const DialectCode = z.enum(["raj", "hry", "bho", "guj", "mar", "ben"]);
export type DialectCode = z.infer<typeof DialectCode>;

export const Ratio = z.enum(["16:9", "9:16", "1:1"]);
export type Ratio = z.infer<typeof Ratio>;

export const FormatCode = z.enum(["SC", "CP", "SU"]);
export type FormatCode = z.infer<typeof FormatCode>;

export const CANVAS: Record<Ratio, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
};

/** Fraction of a 16:9 master's width that survives a centre crop to this ratio. */
export const WIDTH_RETENTION = { "16:9": 1.0, "1:1": 0.5625, "9:16": 0.31640625 } as const;

/** Crop window on a 1920×1080 master for each ratio (§19.1). */
export const MASTER_CROP_WINDOW: Record<Ratio, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "1:1": { w: 1080, h: 1080 },
  "9:16": { w: 608, h: 1080 },
};

export const MASTER = { w: 1920, h: 1080 } as const;

export const DURATIONS = [20, 30, 45, 60] as const;
export const Duration = z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]);
export type Duration = z.infer<typeof Duration>;

export const JobStage = z.enum([
  "QUEUED",
  "PLAN",
  "SCRIPT",
  "ASSEMBLE",
  "COMPOSE",
  "QC",
  "READY",
  "FAILED",
  "CANCELLED",
  "WAITING_PROVIDER",
]);
export type JobStage = z.infer<typeof JobStage>;

/** Stages a retry may start from (§9). */
export const RetryFromStage = z.enum(["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE"]);
export type RetryFromStage = z.infer<typeof RetryFromStage>;

export const PIPELINE_ORDER: JobStage[] = ["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE", "QC"];

export const PromoStatus = z.enum([
  "AWAITING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SCHEDULED",
  "PUBLISHED",
  "MEASURED",
]);
export type PromoStatus = z.infer<typeof PromoStatus>;

export const Verdict = z.enum(["approved", "minor_edit", "major_edit", "rejected"]);
export type Verdict = z.infer<typeof Verdict>;

export const PPPTier = z.enum(["PROVE", "PILOT", "PRODUCTION"]);
export type PPPTier = z.infer<typeof PPPTier>;

export const DIALECT_NAMES: Record<DialectCode, string> = {
  raj: "Rajasthani",
  hry: "Haryanvi",
  bho: "Bhojpuri",
  guj: "Gujarati",
  mar: "Marathi",
  ben: "Bengali",
};

export const FORMAT_NAMES: Record<FormatCode, string> = {
  SC: "Single Clip",
  CP: "Caption Promo",
  SU: "Split UGC",
};
