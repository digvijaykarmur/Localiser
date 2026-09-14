import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planPromo } from "@/services/planner";
import { Recipe, TitleIntelligence, boxInside, safeRect, CTA_DEST, RATIO_CANVAS } from "@/domain";
import { captionDest } from "@/services/assembler/layout";

function loadIntel(titleId: string) {
  const p = path.resolve(process.cwd(), "data/snapshots/intelligence", `${titleId}.json`);
  return TitleIntelligence.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

describe("M2 two-shot SC plan", () => {
  it("uses CAPTION_DOMINANT or STACKED for the two-shot beat at 9:16, never TRACKED_CROP", () => {
    const intel = loadIntel("ttl_hry_01");
    const two = intel.evidence.find((e) => e.shot_type === "TWO_SHOT");
    expect(two).toBeTruthy();
    const angle = intel.angles[0]!;
    const recipe = Recipe.parse({
      id: "rcp_m2",
      version: 1,
      created_at: "2026-09-14T00:00:00.000Z",
      created_by: "test",
      title_id: "ttl_hry_01",
      angle_id: angle.id,
      format: "SC",
      dialect: "hry",
      duration_s: 20,
      ratios: ["16:9", "9:16", "1:1"],
      source_window: { start_ms: 5000, end_ms: 25000 },
      persona_id: null,
      music_brief: null,
      cta_variant: "default",
      cost_envelope_inr: 12,
      planner_prompt_version: "plan.sc.v1",
      seed: 7,
    });
    const plan = planPromo({
      recipe,
      evidence: intel.evidence,
      angle,
      scenes: intel.evidence.map((e) => ({ start_ms: e.start_ms, end_ms: e.end_ms })),
      spoilerBoundary: 1_440_000,
      ratio: "9:16",
    });
    const twoBeat = plan.beats.find((b) => b.evidence_ids.includes(two!.id));
    expect(twoBeat).toBeTruthy();
    expect(["CAPTION_DOMINANT", "STACKED"]).toContain(twoBeat!.treatment);
    expect(twoBeat!.treatment).not.toBe("TRACKED_CROP");
    expect(plan.beats.every((b) => b.evidence_ids.length >= 1)).toBe(true);
    expect(plan.beats.every((b) => b.evidence_ids.every((id) => intel.evidence.some((e) => e.id === id && e.start_ms < 1_440_000)))).toBe(true);
  });

  it("keeps 9:16 text dest inside reserved-safe geometry", () => {
    const canvas = RATIO_CANVAS["9:16"];
    const safe = safeRect("9:16", canvas.width, canvas.height);
    expect(boxInside(CTA_DEST["9:16"], safe)).toBe(true);
    expect(boxInside(captionDest("9:16")!, safe)).toBe(true);
  });
});

describe("composer import boundary", () => {
  it("composer sources do not import vertex or elevenlabs", () => {
    const dir = path.resolve(process.cwd(), "src/services/composer");
    for (const f of fs.readdirSync(dir)) {
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      expect(txt).not.toMatch(/providers\/vertex/);
      expect(txt).not.toMatch(/providers\/elevenlabs/);
    }
  });
});
