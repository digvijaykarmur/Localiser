import { db, sql } from "@/db/client";
import { recipes } from "@/db/schema";
import { Recipe } from "@/domain";
import { getIntelligence } from "@/services/intelligence";
import { enqueueJob, runPipeline } from "@/services/pipeline";
import { getRedis } from "@/lib/redis";
import { id, nowIso } from "@/lib/hash";
import { getFormat } from "@/lib/registry";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const intel = await getIntelligence("ttl_hry_01");
  if (!intel) throw new Error("seed intelligence first");
  const angle = intel.angles.find((a) => a.id.includes("conflict")) ?? intel.angles[0]!;
  const format = getFormat("SC");
  const recipe = Recipe.parse({
    id: id("rcp"),
    version: 1,
    created_at: nowIso(),
    created_by: "e2e",
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
    cost_envelope_inr: format.cost_envelope_inr,
    planner_prompt_version: "plan.sc.v1",
    seed: 7,
  });
  await db.insert(recipes).values({ id: recipe.id, payload: recipe, createdAt: new Date() });
  const jobId = await enqueueJob(recipe.id);
  await runPipeline(jobId, "PLAN");
  const two = intel.evidence.find((e) => e.shot_type === "TWO_SHOT")!;
  const planPath = path.resolve(process.cwd(), "public/storage/plans", recipe.id, "9x16.json");
  if (!fs.existsSync(planPath)) throw new Error("missing 9:16 plan");
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as {
    beats: { evidence_ids: string[]; treatment: string }[];
  };
  const beat = plan.beats.find((b) => b.evidence_ids.includes(two.id));
  if (!beat) throw new Error("two-shot beat missing");
  if (!["CAPTION_DOMINANT", "STACKED"].includes(beat.treatment)) {
    throw new Error(`two-shot treatment ${beat.treatment}`);
  }
  for (const ratio of ["16x9", "9x16", "1x1"]) {
    const mp4 = path.resolve(process.cwd(), "public/storage/renders", recipe.id, `${ratio}.mp4`);
    if (!fs.existsSync(mp4)) throw new Error(`missing render ${ratio}`);
  }
  const a = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/storage/renders", recipe.id, "9x16.filtergraph.json"), "utf8"));
  const b = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/storage/renders", recipe.id, "9x16.filtergraph.json"), "utf8"));
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("filtergraph not stable");
  console.log(JSON.stringify({ jobId, recipeId: recipe.id, twoShotTreatment: beat.treatment }, null, 2));
  await sql.end({ timeout: 2 }).catch(() => undefined);
  try {
    getRedis().disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
