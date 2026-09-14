import fs from "node:fs";
import path from "node:path";
import { db, sql } from "@/db/client";
import { recipes, titles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Recipe } from "@/domain";
import { getIntelligence, ingestTitle, buildIntelligence } from "@/services/intelligence";
import { enqueueJob, runPipeline } from "@/services/pipeline";
import { getFormat } from "@/lib/registry";
import { getRedis } from "@/lib/redis";
import { id, nowIso, ratioFileToken } from "@/lib/hash";
import { env, providers } from "@/lib/env";

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return fallback;
}

async function main() {
  const titleId = arg("title", "ttl_hry_01");
  const format = arg("format", "SC") as "SC" | "CP" | "SU";
  const duration = Number(arg("duration", "20")) as 20 | 30 | 45 | 60;
  if (![20, 30, 45, 60].includes(duration)) throw new Error("duration must be 20|30|45|60");
  if (!["SC", "CP", "SU"].includes(format)) throw new Error("format must be SC|CP|SU");

  let titleRow = (await db.select().from(titles).where(eq(titles.id, titleId)))[0];
  if (!titleRow || providers.antryami) {
    await ingestTitle(titleId);
    titleRow = (await db.select().from(titles).where(eq(titles.id, titleId)))[0];
  }
  if (!titleRow) throw new Error(`title ${titleId} not found in Antaryami/ClickHouse or local db`);
  const dialect = titleRow.dialect;
  let intel = await getIntelligence(titleId);
  if (!intel?.angles.length) {
    intel = await buildIntelligence(titleId);
  }
  if (!intel?.angles.length) {
    throw new Error(`intelligence missing for ${titleId}`);
  }
  const angle = intel.angles.find((a) => a.id.includes("conflict")) ?? intel.angles[0]!;
  const spec = getFormat(format);
  const recipe = Recipe.parse({
    id: id("rcp"),
    version: 1 as const,
    created_at: nowIso(),
    created_by: "local-operator",
    title_id: titleId,
    angle_id: angle.id,
    format,
    dialect,
    duration_s: duration,
    ratios: ["16:9", "9:16", "1:1"],
    source_window: format === "SC" ? { start_ms: 5000, end_ms: 25000 } : null,
    persona_id: format === "SU" ? "persona_local" : null,
    music_brief: format === "SC" ? null : "sparse rural percussion, no vocal",
    cta_variant: "default",
    cost_envelope_inr: spec.cost_envelope_inr,
    planner_prompt_version: format === "CP" ? "plan.cp.v1" : `plan.${format.toLowerCase()}.v1`,
    seed: 7,
  });
  await db.insert(recipes).values({ id: recipe.id, payload: recipe, createdAt: new Date() });
  const jobId = await enqueueJob(recipe.id);
  console.log(
    JSON.stringify(
      {
        jobId,
        recipeId: recipe.id,
        titleId,
        format,
        snapshot_mode: env.SNAPSHOT_MODE,
        elevenlabs: providers.elevenlabs,
      },
      null,
      2,
    ),
  );
  await runPipeline(jobId, "PLAN");
  const renders: Record<string, string> = {};
  for (const ratio of ["16:9", "9:16", "1:1"] as const) {
    const mp4 = path.resolve(
      process.cwd(),
      "public/storage/renders",
      recipe.id,
      `${ratioFileToken(ratio)}.mp4`,
    );
    if (!fs.existsSync(mp4)) throw new Error(`missing render ${ratio}`);
    renders[ratio] = mp4;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        job: `/j/${jobId}`,
        preview: `http://localhost:3000/j/${jobId}`,
        renders,
      },
      null,
      2,
    ),
  );
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
