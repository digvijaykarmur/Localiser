import type { DialectPack, Script, ScriptLine } from "@/domain";
import { Script as ScriptSchema } from "@/domain";
import type { PromoPlan, Recipe } from "@/domain";
import { id } from "@/lib/hash";

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function applyLexicon(text: string, pack: DialectPack): string {
  let out = text;
  for (const [from, to] of Object.entries(pack.lexicon.replace)) {
    out = out.split(from).join(to);
  }
  return out;
}

export function findAvoidHits(text: string, pack: DialectPack): string[] {
  return pack.lexicon.avoid.filter((w) => w && text.includes(w));
}

export function wordBudget(durationS: number, ctaS: number, wps: number): number {
  return Math.floor((durationS - ctaS) * wps);
}

export function scriptExceedsBudget(totalWords: number, durationS: number, ctaS: number, wps: number): boolean {
  return totalWords / wps > durationS - ctaS;
}

export function levenshteinRatio(a: string, b: string): number {
  const s = a.trim();
  const t = b.trim();
  if (s === t) return 1;
  if (!s.length || !t.length) return 0;
  const dp: number[][] = Array.from({ length: s.length + 1 }, () =>
    Array.from({ length: t.length + 1 }, () => 0),
  );
  for (let i = 0; i <= s.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= t.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  const dist = dp[s.length]![t.length]!;
  return 1 - dist / Math.max(s.length, t.length);
}

export function buildScriptDeterministic(args: {
  recipe: Recipe;
  plan: PromoPlan;
  pack: DialectPack;
  forceWordy?: boolean;
}): Script {
  const ctaS = args.plan.beats.find((b) => b.role === "CTA")?.duration_ms
    ? args.plan.beats.find((b) => b.role === "CTA")!.duration_ms / 1000
    : 4;
  const budget = wordBudget(args.recipe.duration_s, ctaS, args.pack.rhythm.words_per_second);
  const voBeats = args.plan.beats.filter((b) => b.role !== "CTA");
  const lines: ScriptLine[] = [];

  const templates: Record<string, string[]> = {
    hry: [
      "के हो रह्या सै?",
      "इब घणा दांव लाग्या",
      "बेरा पलट्या कोन्या",
      "जिब घर टूटण लाग्या",
      "म्हारा लोग डटे सै",
    ],
    raj: [
      "काई हो रह्यो सा",
      "घणो दांव लाग्यो",
      "बाता पलट गई",
      "घर डोलण लाग्यो",
      "म्हारो लोग खड़ो सा",
    ],
  };
  const packLines = templates[args.pack.code] ?? templates.hry!;

  for (let i = 0; i < voBeats.length; i++) {
    const beat = voBeats[i]!;
    let text = packLines[i % packLines.length]!;
    if (args.forceWordy) {
      text =
        "अत्यंत तथा परंतु किंतु यह एक बहुत लंबा वाक्य है जो शब्द सीमा तोड़ता है और और शब्द जोड़ता है";
    }
    text = applyLexicon(text, args.pack);
    const max = args.pack.rhythm.sentence_max_words;
    const words = text.split(/\s+/);
    if (words.length > max) text = words.slice(0, max).join(" ");
    lines.push({
      id: id("ln"),
      beat_index: beat.index,
      text,
      evidence_ids: beat.evidence_ids,
      word_count: countWords(text),
    });
  }

  const total = lines.reduce((s, l) => s + l.word_count, 0);
  return ScriptSchema.parse({
    recipe_id: args.recipe.id,
    dialect: args.recipe.dialect,
    lines,
    total_words: total,
    word_budget: budget,
    cta_s: ctaS,
  });
}

export function enforceScript(script: Script, pack: DialectPack, durationS: number): {
  script: Script;
  rejected: string | null;
} {
  const lines = script.lines.map((l) => {
    const text = applyLexicon(l.text, pack);
    return { ...l, text, word_count: countWords(text) };
  });
  const joined = lines.map((l) => l.text).join(" ");
  const avoid = findAvoidHits(joined, pack);
  if (avoid.length) return { script, rejected: `avoid words: ${avoid.join(",")}` };
  const total = lines.reduce((s, l) => s + l.word_count, 0);
  if (scriptExceedsBudget(total, durationS, script.cta_s, pack.rhythm.words_per_second)) {
    return {
      script,
      rejected: `word budget ${total} / ${pack.rhythm.words_per_second} > ${durationS - script.cta_s}`,
    };
  }
  return {
    script: ScriptSchema.parse({ ...script, lines, total_words: total }),
    rejected: null,
  };
}
