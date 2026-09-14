import { z } from "zod";
import { DialectCode } from "./codes";

export const ScriptLine = z.object({
  id: z.string(),
  beat_index: z.number().int(),
  text: z.string(),
  evidence_ids: z.array(z.string()).min(1),
  word_count: z.number().int().nonnegative(),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const Script = z.object({
  recipe_id: z.string(),
  dialect: DialectCode,
  lines: z.array(ScriptLine),
  total_words: z.number().int().nonnegative(),
  word_budget: z.number(),
  cta_s: z.number(),
});
export type Script = z.infer<typeof Script>;
