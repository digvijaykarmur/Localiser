import { z } from "zod";

export const DialectCode = z.enum(["raj", "hry", "bho", "guj", "mar", "ben"]);
export type DialectCode = z.infer<typeof DialectCode>;

export const Ratio = z.enum(["16:9", "9:16", "1:1"]);
export type Ratio = z.infer<typeof Ratio>;

export const FormatCode = z.enum(["SC", "CP", "SU"]);
export type FormatCode = z.infer<typeof FormatCode>;

export const PipelineStage = z.enum([
  "INGEST",
  "INTELLIGENCE",
  "RECIPE_LOCK",
  "PLAN",
  "SCRIPT",
  "ASSEMBLE",
  "COMPOSE",
  "QC",
]);
export type PipelineStage = z.infer<typeof PipelineStage>;

export const RATIO_CANVAS = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
} as const;

export const CROP_WINDOW_ON_MASTER = {
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "9:16": { width: 608, height: 1080 },
} as const;

export const MASTER_WIDTH = 1920;
export const MASTER_HEIGHT = 1080;
export const OUTPUT_FPS = 30;
export const CROP_VELOCITY_MAX_FRAC_PER_SEC = 0.08;
export const FRAME_BUDGET_THRESHOLD = 0.6;
export const SPOILER_BOUNDARY_DEFAULT_FRAC = 0.6;
export const SC_BOUNDARY_REFINE_MS = 1500;
export const SPEAKER_CUT_MIN_HOLD_MS = 1200;
export const KENBURNS_MIN_BEAT_MS = 2000;
export const KENBURNS_MAX_BEATS = 2;
export const JOB_STAGES_AFTER_RECIPE: PipelineStage[] = [
  "PLAN",
  "SCRIPT",
  "ASSEMBLE",
  "COMPOSE",
  "QC",
];
