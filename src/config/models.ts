import { z } from "zod";
import raw from "./models.json";

const ModelEntry = z.object({ model: z.string(), temperature: z.number().min(0).max(2).optional(), fallback: z.string().optional() });

const ModelsConfig = z.object({
  evidence_vision: ModelEntry,
  angles: ModelEntry,
  plan: ModelEntry,
  script: ModelEntry,
  judge: ModelEntry,
  asr: ModelEntry,
  image: ModelEntry,
  video: ModelEntry,
  music: ModelEntry,
  pricing_usd_per_million_tokens: z.record(z.string(), z.object({ in: z.number(), out: z.number() })),
  pricing_usd_flat: z.object({
    image_per_call: z.number(),
    video_per_second: z.number(),
    elevenlabs_tts_per_1k_chars: z.number(),
    elevenlabs_music_per_call: z.number(),
    asr_per_minute: z.number(),
  }),
});
export type ModelsConfig = z.infer<typeof ModelsConfig>;

export const models: ModelsConfig = ModelsConfig.parse(raw);

/** TBR startup assertion (§23.1, acceptance test 17): the judge must not be the author. */
export function assertTwoBrainRule(cfg: ModelsConfig = models): void {
  if (cfg.judge.model === cfg.plan.model) {
    throw new Error(
      `Two-Brain Rule violated: judge.model (${cfg.judge.model}) must differ from plan.model (${cfg.plan.model}). Fix src/config/models.json.`,
    );
  }
}

export function tokenCostInr(model: string, tokensIn: number, tokensOut: number, inrPerUsd: number): number {
  const p = models.pricing_usd_per_million_tokens[model] ?? models.pricing_usd_per_million_tokens.default!;
  const usd = (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
  return round2(usd * inrPerUsd);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
