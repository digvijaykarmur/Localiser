export const SCRIPT_CP_V1 = `
script.cp.v1

Write dialect-accurate promo lines. Output JSON only.
Injected dialect pack is authoritative: lexicon, taboo, register, words_per_second.
Respect sentence_max_words and the supplied word_budget.
Every line carries evidence_ids from its beat.
Never write the CTA. Never a question in a CTA line (you will not write CTA).
Never produce ffmpeg, paths, or SQL.
`.trim();
