import { z } from "zod";
import { DialectCode } from "./primitives";

export const VoiceSettings = z.object({
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
  style: z.number().min(0).max(1),
  speed: z.number().min(0.5).max(1.5),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const DialectPack = z.object({
  code: DialectCode,
  name: z.string(),
  version: z.string(), // e.g. hry.v3
  script: z.enum(["devanagari", "bengali", "gujarati"]),
  channel_id: z.string(),

  voice: z.object({
    provider: z.literal("elevenlabs"),
    voice_id: z.string(),
    model: z.string(),
    language_code: z.string(),
    settings: VoiceSettings,
  }),

  rhythm: z.object({
    words_per_second: z.number().positive(),
    sentence_max_words: z.number().int().positive(),
    caption_max_words: z.number().int().positive(),
    beat_min_ms: z.number().int().min(700),
    beat_max_ms: z.number().int().positive(),
    hook_max_ms: z.number().int().positive(),
  }),

  lexicon: z.object({
    replace: z.record(z.string(), z.string()),
    prefer: z.array(z.string()),
    avoid: z.array(z.string()),
  }),

  taboo: z.object({ words: z.array(z.string()), themes: z.array(z.string()) }),

  cta_templates: z.record(z.string(), z.string()).refine((t) => "default" in t, "cta_templates.default is required"),

  typography: z.object({
    caption_font: z.string(),
    caption_size_916: z.number().int().positive(),
    caption_size_11: z.number().int().positive(),
    caption_size_169: z.number().int().positive(),
    line_height: z.number().positive(),
  }),

  register: z.string(),
});
export type DialectPack = z.infer<typeof DialectPack>;

/** Pack completeness for the /dialects cards (§6). */
export function packCompleteness(p: DialectPack) {
  return {
    voice: p.voice.voice_id.length > 0 && !p.voice.voice_id.startsWith("<"),
    rhythm: p.rhythm.words_per_second > 0,
    lexicon_entries: Object.keys(p.lexicon.replace).length + p.lexicon.prefer.length,
    taboo: p.taboo.words.length + p.taboo.themes.length,
    cta_variants: Object.keys(p.cta_templates).length,
  };
}

/** Bump `xxx.vN` → `xxx.vN+1`. */
export function bumpPackVersion(version: string, code: string): string {
  const m = /^(.*)\.v(\d+)$/.exec(version);
  if (!m) return `${code}.v1`;
  return `${m[1]}.v${Number(m[2]) + 1}`;
}

/** Apply the `replace` map mechanically (§20.3 silent fix). Longest keys first. */
export function applyLexiconReplace(text: string, replace: Record<string, string>): string {
  const keys = Object.keys(replace).sort((a, b) => b.length - a.length);
  let out = text;
  for (const k of keys) {
    const v = replace[k]!;
    out = out.split(k).join(v);
  }
  return out;
}

/** Any `avoid` word present → offenders listed. */
export function findAvoidWords(text: string, avoid: string[]): string[] {
  return avoid.filter((w) => w.length > 0 && text.includes(w));
}

export function renderCta(template: string, titleName: string): string {
  return template.split("{title}").join(titleName);
}
