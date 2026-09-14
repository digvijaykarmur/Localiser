import { z } from "zod";
import { DialectCode, FormatCode, Ratio } from "./codes";
import { Treatment } from "./plan";

export const DialectPack = z.object({
  code: DialectCode,
  name: z.string(),
  script: z.enum(["devanagari", "bengali", "gujarati"]),
  channel_id: z.string(),
  voice: z.object({
    provider: z.literal("elevenlabs"),
    voice_id: z.string(),
    model: z.string(),
    language_code: z.string(),
    settings: z.object({
      stability: z.number(),
      similarity_boost: z.number(),
      style: z.number(),
      speed: z.number(),
    }),
  }),
  rhythm: z.object({
    words_per_second: z.number().positive(),
    sentence_max_words: z.number().int().positive(),
    caption_max_words: z.number().int().positive(),
    beat_min_ms: z.number().int().positive(),
    beat_max_ms: z.number().int().positive(),
    hook_max_ms: z.number().int().positive(),
  }),
  lexicon: z.object({
    replace: z.record(z.string(), z.string()),
    prefer: z.array(z.string()),
    avoid: z.array(z.string()),
  }),
  taboo: z.object({
    words: z.array(z.string()),
    themes: z.array(z.string()),
  }),
  cta_templates: z.record(z.string(), z.string()),
  typography: z.object({
    caption_font: z.string(),
    caption_size_916: z.number(),
    caption_size_11: z.number(),
    caption_size_169: z.number(),
    line_height: z.number(),
  }),
  register: z.string(),
});
export type DialectPack = z.infer<typeof DialectPack>;

export const FormatDef = z.object({
  code: FormatCode,
  name: z.string(),
  beats: z.object({ min: z.number().int(), max: z.number().int() }),
  uses: z.object({
    vo: z.boolean(),
    music: z.union([z.boolean(), z.enum(["optional", "bed"])]),
    presenter: z.boolean(),
    source_audio: z.union([z.boolean(), z.enum(["ducked"])]),
  }),
  caption_mode: z.enum(["burned_asr", "authored_cards"]),
  cta: z.string(),
  cost_envelope_inr: z.number().positive(),
  ratio_policy: z.record(Ratio, z.array(Treatment).min(1)),
  presenter: z
    .object({
      provider: z.string(),
      generate_at_target_ratio: z.boolean(),
      max_segment_ms: z.number().int(),
    })
    .optional(),
  geometry: z.record(z.string(), z.unknown()).optional(),
});
export type FormatDef = z.infer<typeof FormatDef>;
