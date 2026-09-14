import { z } from "zod";
import models from "@/config/models.json";

export const ModelConfig = z.object({
  id: z.string(),
  temperature: z.number().optional(),
  fallback: z.string().optional(),
  purpose: z.string(),
});

export type ModelConfig = z.infer<typeof ModelConfig>;

export function getModel(
  purpose:
    | "evidence_vision"
    | "angle"
    | "planning"
    | "scripting"
    | "judge"
    | "asr"
    | "presenter_still"
    | "presenter_video",
): ModelConfig {
  return ModelConfig.parse(models[purpose]);
}

export const MODEL_PURPOSES = [
  "evidence_vision",
  "angle",
  "planning",
  "scripting",
  "judge",
  "asr",
  "presenter_still",
  "presenter_video",
] as const;
