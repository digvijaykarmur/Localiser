import { z } from "zod";
import { Ratio } from "./codes";

export const Treatment = z.enum([
  "NATIVE",
  "TRACKED_CROP",
  "STATIC_CROP",
  "STACKED",
  "CAPTION_DOMINANT",
  "INSET",
  "KENBURNS_STILL",
  "GENERATED_NATIVE",
]);
export type Treatment = z.infer<typeof Treatment>;

export const BeatRole = z.enum(["HOOK", "STAKE", "TURN", "ESCALATE", "CTA"]);
export type BeatRole = z.infer<typeof BeatRole>;

export const Beat = z.object({
  index: z.number().int(),
  role: BeatRole,
  start_ms: z.number().int(),
  duration_ms: z.number().int().min(700),
  evidence_ids: z.array(z.string()).min(1),
  intensity: z.number().int().min(1).max(10),
  treatment: Treatment,
  treatment_reason: z.string().max(160),
  script_line_id: z.string().nullable(),
  caption_text: z.string().nullable(),
});
export type Beat = z.infer<typeof Beat>;

export const PromoPlan = z.object({
  recipe_id: z.string(),
  ratio: Ratio,
  beats: z.array(Beat).min(4).max(9),
  frame_budget: z.object({
    croppable_fraction: z.number(),
    composition_first: z.boolean(),
  }),
  total_duration_ms: z.number().int(),
});
export type PromoPlan = z.infer<typeof PromoPlan>;
