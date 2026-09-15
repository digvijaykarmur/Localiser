import { z } from "zod";

export const ScriptLineRole = z.enum(["vo", "presenter", "caption"]);

export const ScriptLine = z.object({
  id: z.string(),
  beat_index: z.number().int(),
  role: ScriptLineRole,
  text_native: z.string(), // Devanagari / Bengali / Gujarati
  word_count: z.number().int(),
  evidence_ids: z.array(z.string()).min(1), // EGC applies to lines too
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const Script = z.object({
  recipe_id: z.string(),
  lines: z.array(ScriptLine),
  total_words: z.number().int(),
  budget_words: z.number().int(),
  within_budget: z.boolean(),
});
export type Script = z.infer<typeof Script>;

/** Model output: lines without ids/word counts; code fills those in. */
export const ScriptProposalLine = z.object({
  beat_index: z.number().int(),
  role: ScriptLineRole,
  text_native: z.string().min(1),
  evidence_ids: z.array(z.string()).min(1),
});
export const ScriptProposal = z.object({ lines: z.array(ScriptProposalLine).min(1) });
export type ScriptProposal = z.infer<typeof ScriptProposal>;

/** Word counting for Indic scripts: whitespace-separated tokens, punctuation stripped. */
export function countWords(text: string): number {
  return text
    .replace(/[।॥,.!?;:"'()\-–—…]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0).length;
}

/** Word budget (§17.4): (duration − cta) × words_per_second, floored. */
export function wordBudget(durationS: number, ctaDurationS: number, wordsPerSecond: number): number {
  return Math.floor((durationS - ctaDurationS) * wordsPerSecond);
}

/** Post-script DAL check (§20.3): total_words / wps must fit within the non-CTA duration. */
export function withinBudget(totalWords: number, wps: number, durationS: number, ctaS: number): boolean {
  return totalWords / wps <= durationS - ctaS;
}
