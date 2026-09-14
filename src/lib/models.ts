import { z } from "zod";
import models from "@/config/models.json";
import { env } from "@/lib/env";

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
  const base = ModelConfig.parse(models[purpose]);
  if ((purpose === "planning" || purpose === "scripting" || purpose === "angle") && env.VERTEX_PLAN_MODEL) {
    return { ...base, id: env.VERTEX_PLAN_MODEL };
  }
  if ((purpose === "judge" || purpose === "asr" || purpose === "evidence_vision") && env.VERTEX_JUDGE_MODEL) {
    return { ...base, id: env.VERTEX_JUDGE_MODEL };
  }
  return base;
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
