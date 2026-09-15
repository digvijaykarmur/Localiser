/**
 * Drive one promo through S1–S8 inline (no BullMQ workers), then print the result.
 *
 *   pnpm pipeline:run -- --title t_kalyani --format SC --dialect hry --duration 30 [--ratios 16:9,9:16,1:1] [--angle ang_...]
 *
 * In SNAPSHOT_MODE this runs fully offline and is the M2/M3/M6 acceptance harness.
 */
import { eq } from "drizzle-orm";
import { db, schema, sql } from "@/db/client";
import { PIPELINE_ORDER, type DialectCode, type FormatCode, type Ratio } from "@/domain";
import { buildIntelligence } from "@/services/intelligence/build";
import { syncTitles } from "@/services/intelligence/ingest";
import { createJob, runStage } from "@/services/pipeline";
import { getJobView } from "@/services/pipeline/jobs";
import { setInlineMode } from "@/services/pipeline/queue";
import { createRecipe } from "@/services/recipes";
import { getAngles } from "@/services/titles";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  setInlineMode(true);
  const titleId = arg("title", "t_kalyani")!;
  const format = arg("format", "SC") as FormatCode;
  const duration = Number(arg("duration", "30")) as 20 | 30 | 45 | 60;
  const ratios = (arg("ratios", "16:9,9:16,1:1")!.split(",") as Ratio[]).filter(Boolean);

  const existing = await db.query.titles.findFirst({ where: eq(schema.titles.id, titleId) });
  if (!existing) {
    const s = await syncTitles();
    console.log(`synced ${s.synced} titles`);
  }
  const title = (await db.query.titles.findFirst({ where: eq(schema.titles.id, titleId) }))!;
  const dialect = (arg("dialect") ?? title.dialect) as DialectCode;

  const intel = await buildIntelligence(titleId);
  console.log(`intelligence: ${intel.evidence.length} evidence units, ${intel.angles} angles, ₹${intel.cost_inr}`);

  const angles = await getAngles(titleId);
  const angleId = arg("angle") ?? (angles.find((a) => a.spoiler_safe && a.vertical_feasible) ?? angles[0])!.id;
  const { recipe, preview } = await createRecipe({ title_id: titleId, angle_id: angleId, format, dialect, duration_s: duration, ratios, source_window: null, persona_id: format === "SU" ? "persona_default" : null, music_brief: format === "SC" ? null : "restrained tabla and strings, rising tension", cta_variant: "default", created_by: "script" });
  console.log(`recipe ${recipe.id}: est ₹${preview.estimate.total}, envelope ₹${recipe.cost_envelope_inr}`);
  for (const r of ratios) console.log(`  frame budget ${r}: ${(preview.frame_budget[r].croppable_fraction * 100).toFixed(0)}% croppable${preview.frame_budget[r].composition_first ? ` → composition-first ${preview.frame_budget[r].chosen_composition}` : ""}`);

  const { jobId, promoId } = await createJob(recipe.id);
  console.log(`job ${jobId} promo ${promoId}`);
  const t0 = Date.now();
  let stage: (typeof PIPELINE_ORDER)[number] | null = PIPELINE_ORDER[0]!;
  while (stage) {
    const s0 = Date.now();
    const r = await runStage(jobId, stage);
    const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
    console.log(`  ${stage.padEnd(8)} ${((Date.now() - s0) / 1000).toFixed(1)}s  → ${job?.stage}  ₹${Number(job?.costSpentInr).toFixed(2)}`);
    if (job?.stage === "FAILED") {
      console.error(JSON.stringify(job.error, null, 2));
      break;
    }
    stage = r.next;
  }
  const view = await getJobView(jobId);
  console.log(`\nfinal stage ${view.stage} in ${((Date.now() - t0) / 1000).toFixed(1)}s, cost ₹${view.cost_spent_inr}`);
  for (const [ratio, tl] of Object.entries(view.timelines)) {
    const plan = view.plans[ratio] as { beats: { role: string; treatment: string }[] } | undefined;
    console.log(`  ${ratio}: ${plan?.beats.map((b) => `${b.role}:${b.treatment}`).join(" ")}`);
    const t = tl as { layers: unknown[]; audio: unknown[] };
    console.log(`        ${t.layers.length} layers, ${t.audio.length} audio tracks, render ${view.renders[ratio] ?? "-"}`);
  }
  for (const [ratio, qc] of Object.entries(view.qc)) {
    const q = qc as { deterministic: { checks: { id: string; pass: boolean; detail: string }[] }; ai: { gates_pass: boolean } | null; gate_pass: boolean };
    const failed = q.deterministic.checks.filter((c) => !c.pass);
    console.log(`  QC ${ratio}: D ${q.deterministic.checks.length - failed.length}/${q.deterministic.checks.length}${failed.length ? " FAIL " + failed.map((f) => `${f.id}(${f.detail})`).join("; ") : ""} · AI ${q.ai ? (q.ai.gates_pass ? "pass" : "FAIL") : "skipped"} · gate ${q.gate_pass ? "PASS" : "FAIL"}`);
  }
  console.log(`\nopen http://localhost:3000/j/${jobId}`);
  await sql.end();
  process.exit(view.stage === "READY" ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
