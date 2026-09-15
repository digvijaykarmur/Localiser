import { models } from "@/config/models";
import {
  applyLexiconReplace,
  countWords,
  findAvoidWords,
  renderCta,
  Script,
  ScriptProposal,
  wordBudget,
  withinBudget,
  type DialectPack,
  type EvidenceUnit,
  type FormatPolicy,
  type PromoPlan,
  type Recipe,
  type ScriptLine,
  type Title,
} from "@/domain";
import { SCRIPT_V2, withInput } from "@/prompts";
import { callModel } from "../cost/modelClient";
import type { CostMeter } from "../cost/meter";

export interface ScriptContext {
  recipe: Recipe;
  title: Title;
  plan: PromoPlan; // the 16:9 plan
  evidence: Map<string, EvidenceUnit>;
  pack: DialectPack;
  policy: FormatPolicy;
  meter: CostMeter;
  jobId: string;
  claim: string;
}

/** S5 — one script, shared across ratios (§17.4). DAL enforced mechanically (§20.3). */
export async function buildScript(ctx: ScriptContext): Promise<{ script: Script; cost_inr: number }> {
  const { recipe, plan, pack, policy } = ctx;
  const budget = wordBudget(recipe.duration_s, policy.cta_duration_s, pack.rhythm.words_per_second);
  const ctaTemplate = pack.cta_templates[recipe.cta_variant] ?? pack.cta_templates.default!;
  const ctaText = renderCta(ctaTemplate, ctx.title.name_native);
  const bodyBeats = plan.beats.filter((b) => b.role !== "CTA");
  const beatIndices = new Set(bodyBeats.map((b) => b.index));

  const input = {
    dialect: pack.code,
    budget_words: budget,
    cta_template: ctaText,
    claim: ctx.claim,
    title: { name: ctx.title.name, name_native: ctx.title.name_native, synopsis: ctx.title.synopsis },
    dialect_pack: { register: pack.register, script: pack.script, rhythm: pack.rhythm, lexicon: pack.lexicon, taboo: pack.taboo },
    beats: bodyBeats.map((b) => ({
      index: b.index,
      role: b.role,
      duration_ms: b.duration_ms,
      intensity: b.intensity,
      evidence_ids: b.evidence_ids,
      evidence: b.evidence_ids.map((id) => ctx.evidence.get(id)).filter(Boolean).map((e) => ({ id: e!.id, description: e!.description, dialogue_native: e!.dialogue_native, emotion: e!.emotion })),
      dialogue: b.evidence_ids.map((id) => ctx.evidence.get(id)?.dialogue_native).filter((d): d is string => !!d),
    })),
  };

  const r = await callModel({
    schema: ScriptProposal,
    model: models.script.model,
    temperature: models.script.temperature ?? 0.9,
    seed: recipe.seed,
    system: SCRIPT_V2.system,
    user: [{ text: withInput(`Write the script. Word budget: ${budget} words across all vo lines.`, input) }],
    meta: { stage: "script", prompt_version: SCRIPT_V2.version, recipe_id: recipe.id, title_id: recipe.title_id, job_id: ctx.jobId },
    meter: ctx.meter,
    costItem: "vertex.script",
    verify: (p) => verifyScript(p, { pack, budget, beatIndices, beats: plan, durationS: recipe.duration_s, ctaS: policy.cta_duration_s }),
  });

  const lines: ScriptLine[] = r.value.lines.map((l, i) => {
    const text = applyLexiconReplace(l.text_native, pack.lexicon.replace);
    return { id: `ln_${i}`, beat_index: l.beat_index, role: l.role, text_native: text, word_count: countWords(text), evidence_ids: l.evidence_ids };
  });
  const cta = plan.beats.find((b) => b.role === "CTA");
  if (cta) lines.push({ id: `ln_cta`, beat_index: cta.index, role: "caption", text_native: ctaText, word_count: countWords(ctaText), evidence_ids: cta.evidence_ids });

  const total = lines.filter((l) => l.role === "vo" || l.role === "presenter").reduce((s, l) => s + l.word_count, 0);
  const script = Script.parse({ recipe_id: recipe.id, lines, total_words: total, budget_words: budget, within_budget: withinBudget(total, pack.rhythm.words_per_second, recipe.duration_s, policy.cta_duration_s) });
  return { script, cost_inr: r.cost_inr };
}

export function verifyScript(
  p: ScriptProposal,
  o: { pack: DialectPack; budget: number; beatIndices: Set<number>; beats: PromoPlan; durationS: number; ctaS: number },
): string[] {
  const issues: string[] = [];
  let total = 0;
  const beatsWithVo = new Set<number>();
  for (const [i, l] of p.lines.entries()) {
    const text = applyLexiconReplace(l.text_native, o.pack.lexicon.replace);
    const wc = countWords(text);
    if (!o.beatIndices.has(l.beat_index)) issues.push(`line ${i}: beat_index ${l.beat_index} is not a non-CTA beat`);
    if (l.role === "vo" || l.role === "presenter") {
      total += wc;
      beatsWithVo.add(l.beat_index);
      if (wc > o.pack.rhythm.sentence_max_words * 2) issues.push(`line ${i}: ${wc} words; keep sentences ≤ ${o.pack.rhythm.sentence_max_words} words`);
    }
    if (l.role === "caption" && wc > o.pack.rhythm.caption_max_words) issues.push(`line ${i}: caption has ${wc} words; max ${o.pack.rhythm.caption_max_words}`);
    const avoid = findAvoidWords(text, o.pack.lexicon.avoid);
    if (avoid.length) issues.push(`line ${i}: uses avoided words ${avoid.join(", ")}`);
    const taboo = findAvoidWords(text, o.pack.taboo.words);
    if (taboo.length) issues.push(`line ${i}: uses taboo words ${taboo.join(", ")}`);
    if (/[A-Za-z]{4,}/.test(text.replace(/STAGE/g, ""))) issues.push(`line ${i}: romanised text detected; write in ${o.pack.script}`);
    const beat = o.beats.beats.find((b) => b.index === l.beat_index);
    if (beat && l.evidence_ids.some((id) => !beat.evidence_ids.includes(id))) issues.push(`line ${i}: cites evidence not in beat ${l.beat_index}`);
  }
  if (total > o.budget) issues.push(`total vo words ${total} exceed budget ${o.budget} (= (${o.durationS}s − ${o.ctaS}s) × ${o.pack.rhythm.words_per_second} wps). Cut words.`);
  if (!withinBudget(total, o.pack.rhythm.words_per_second, o.durationS, o.ctaS)) issues.push(`vo would take ${(total / o.pack.rhythm.words_per_second).toFixed(1)}s; only ${o.durationS - o.ctaS}s available`);
  for (const bi of o.beatIndices) if (!beatsWithVo.has(bi)) issues.push(`beat ${bi} has no vo line`);
  return issues;
}

/** Single Clip has no script: captions come from the source dialogue itself. */
export function sourceOnlyScript(recipe: Recipe, plan: PromoPlan, evidence: Map<string, EvidenceUnit>, pack: DialectPack, titleNative: string): Script {
  const lines: ScriptLine[] = [];
  for (const b of plan.beats) {
    if (b.role === "CTA") {
      const t = renderCta(pack.cta_templates[recipe.cta_variant] ?? pack.cta_templates.default!, titleNative);
      lines.push({ id: "ln_cta", beat_index: b.index, role: "caption", text_native: t, word_count: countWords(t), evidence_ids: b.evidence_ids });
      continue;
    }
    const e = evidence.get(b.evidence_ids[0]!);
    if (e?.dialogue_native) {
      const words = e.dialogue_native.split(/\s+/).slice(0, pack.rhythm.caption_max_words).join(" ");
      lines.push({ id: `ln_${b.index}`, beat_index: b.index, role: "caption", text_native: words, word_count: countWords(words), evidence_ids: [e.id] });
    }
  }
  return Script.parse({ recipe_id: recipe.id, lines, total_words: 0, budget_words: 0, within_budget: true });
}
