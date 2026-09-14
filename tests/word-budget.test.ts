import { describe, expect, it } from "vitest";
import {
  applyLexicon,
  buildScriptDeterministic,
  enforceScript,
  scriptExceedsBudget,
  wordBudget,
} from "@/services/scripter";
import { getDialectPack } from "@/lib/registry";
import { PromoPlan, Recipe } from "@/domain";

const recipe = Recipe.parse({
  id: "rcp_test",
  version: 1,
  created_at: "2026-09-14T00:00:00.000Z",
  created_by: "test",
  title_id: "ttl_hry_01",
  angle_id: "ang",
  format: "CP",
  dialect: "hry",
  duration_s: 20,
  ratios: ["9:16"],
  source_window: null,
  persona_id: null,
  music_brief: "bed",
  cta_variant: "default",
  cost_envelope_inr: 55,
  planner_prompt_version: "plan.cp.v1",
  seed: 1,
});

function plan(): PromoPlan {
  const beat = (index: number, role: "HOOK" | "STAKE" | "TURN" | "ESCALATE" | "CTA", start: number, dur: number) => ({
    index,
    role,
    start_ms: start,
    duration_ms: dur,
    evidence_ids: [`ev_${index}`],
    intensity: 5 + index,
    treatment: "CAPTION_DOMINANT" as const,
    treatment_reason: "test",
    script_line_id: null,
    caption_text: null,
  });
  return PromoPlan.parse({
    recipe_id: recipe.id,
    ratio: "9:16",
    beats: [
      beat(0, "HOOK", 0, 3000),
      beat(1, "STAKE", 3000, 4000),
      beat(2, "TURN", 7000, 4000),
      beat(3, "ESCALATE", 11000, 5000),
      beat(4, "CTA", 16000, 4000),
    ],
    frame_budget: { croppable_fraction: 0.4, composition_first: true },
    total_duration_ms: 20000,
  });
}

describe("word budget", () => {
  it("computes duration minus CTA times words_per_second", () => {
    expect(wordBudget(20, 4, 2.4)).toBe(Math.floor(16 * 2.4));
  });

  it("rejects an artificially wordy script", () => {
    const pack = getDialectPack("hry");
    const wordy = buildScriptDeterministic({ recipe, plan: plan(), pack, forceWordy: true });
    const checked = enforceScript(wordy, pack, 20);
    expect(checked.rejected).toMatch(/word budget|avoid/);
    expect(scriptExceedsBudget(wordy.total_words, 20, wordy.cta_s, pack.rhythm.words_per_second) || Boolean(checked.rejected)).toBe(true);
  });

  it("applies the replace map mechanically", () => {
    const pack = getDialectPack("hry");
    expect(applyLexicon("बहुत क्या", pack)).toBe("घणा के");
  });
});
