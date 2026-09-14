import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  artifacts,
  jobs,
  promoPlans,
  recipes as recipesTable,
  scripts as scriptsTable,
  timelines as timelinesTable,
  titles,
} from "@/db/schema";
import {
  LedgerRow,
  PromoPlan,
  Recipe,
  Script,
  Timeline,
  Title,
  type PipelineStage,
  type Ratio,
} from "@/domain";
import { id, nowIso, ratioFileToken, sha256 } from "@/lib/hash";
import { getDialectPack, getFormat } from "@/lib/registry";
import { storage } from "@/providers/storage";
import { getVertex } from "@/providers/vertex";
import { costMeter } from "@/services/cost/meter";
import { assembleRatio } from "@/services/assembler";
import { composeTimeline } from "@/services/composer";
import { filtergraphSnapshot } from "@/services/composer/filtergraph";
import { getIntelligence } from "@/services/intelligence";
import { planPromo, validatePlanAgainstEvidence } from "@/services/planner";
import { buildScriptDeterministic, enforceScript, levenshteinRatio } from "@/services/scripter";
import { runDeterministicQc } from "@/services/qc/deterministic";
import { runAiJudge } from "@/services/qc/judge";
import { upsertLedger } from "@/services/ledger";
import { scenes } from "@/db/schema";

const STAGE_ORDER: PipelineStage[] = ["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE", "QC"];

async function cached<T>(
  recipeId: string,
  stage: string,
  ratio: string,
  inputHash: string,
): Promise<T | null> {
  const rows = await db.select().from(artifacts);
  const hit = rows.find(
    (r) =>
      r.recipeId === recipeId && r.stage === stage && r.ratio === ratio && r.inputHash === inputHash,
  );
  return (hit?.payload as T) ?? null;
}

async function saveArtifact(args: {
  recipeId: string;
  stage: string;
  ratio: string;
  inputHash: string;
  storageKey: string;
  payload: Record<string, unknown>;
}) {
  await db.insert(artifacts).values({
    recipeId: args.recipeId,
    stage: args.stage,
    ratio: args.ratio,
    inputHash: args.inputHash,
    storageKey: args.storageKey,
    payload: args.payload,
    createdAt: new Date(),
  });
}

async function setJob(jobId: string, patch: Partial<typeof jobs.$inferInsert>) {
  await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export async function runPipeline(jobId: string, fromStage: PipelineStage = "PLAN") {
  const jobRows = await db.select().from(jobs).where(eq(jobs.id, jobId));
  const job = jobRows[0];
  if (!job) throw new Error("job not found");
  const recipeRow = (await db.select().from(recipesTable).where(eq(recipesTable.id, job.recipeId)))[0];
  if (!recipeRow) throw new Error("recipe not found");
  const recipe = Recipe.parse(recipeRow.payload);
  const titleRow = (await db.select().from(titles).where(eq(titles.id, recipe.title_id)))[0];
  if (!titleRow) throw new Error("title not found");
  const title = Title.parse({
    id: titleRow.id,
    name: titleRow.name,
    name_native: titleRow.nameNative,
    dialect: titleRow.dialect,
    synopsis: titleRow.synopsis,
    runtime_ms: titleRow.runtimeMs,
    spoiler_boundary_ms: titleRow.spoilerBoundaryMs,
    genre: titleRow.genre,
    artwork_url: titleRow.artworkUrl,
    deep_link: titleRow.deepLink,
  });
  const intel = await getIntelligence(recipe.title_id);
  if (!intel) throw new Error("intelligence missing");
  const angle = intel.angles.find((a) => a.id === recipe.angle_id);
  if (!angle) throw new Error("angle missing");
  const sceneRows = await db.select().from(scenes);
  const titleScenes = sceneRows
    .filter((s) => s.titleId === recipe.title_id)
    .map((s) => ({ start_ms: s.startMs, end_ms: s.endMs }));
  const pack = getDialectPack(recipe.dialect);
  const format = getFormat(recipe.format);
  const t0 = Date.now();
  const start = STAGE_ORDER.indexOf(fromStage);
  const ratios = recipe.ratios as Ratio[];

  try {
    await setJob(jobId, { status: "running", stage: fromStage, progress: 5 });

    const plans = new Map<Ratio, PromoPlan>();
    if (start <= 0) {
      await setJob(jobId, { stage: "PLAN", progress: 15 });
      for (const ratio of ratios) {
        const inputHash = sha256(recipe.id, "PLAN", ratio, String(recipe.seed));
        const hit = await cached<PromoPlan>(recipe.id, "PLAN", ratio, inputHash);
        const plan =
          hit ??
          planPromo({
            recipe,
            evidence: intel.evidence,
            angle,
            scenes: titleScenes,
            spoilerBoundary: title.spoiler_boundary_ms,
            ratio,
          });
        validatePlanAgainstEvidence(plan, intel.evidence, title.spoiler_boundary_ms);
        plans.set(ratio, plan);
        await db
          .insert(promoPlans)
          .values({ recipeId: recipe.id, ratio, payload: plan })
          .onConflictDoUpdate({
            target: [promoPlans.recipeId, promoPlans.ratio],
            set: { payload: plan },
          });
        if (!hit) {
          await saveArtifact({
            recipeId: recipe.id,
            stage: "PLAN",
            ratio,
            inputHash,
            storageKey: `plans/${recipe.id}/${ratioFileToken(ratio)}.json`,
            payload: plan,
          });
          await storage.put(
            `plans/${recipe.id}/${ratioFileToken(ratio)}.json`,
            JSON.stringify(plan, null, 2),
          );
        }
      }
    } else {
      for (const ratio of ratios) {
        const row = (
          await db.select().from(promoPlans)
        ).find((p) => p.recipeId === recipe.id && p.ratio === ratio);
        if (!row) throw new Error(`plan missing ${ratio}`);
        plans.set(ratio, PromoPlan.parse(row.payload));
      }
    }

    let script: Script | null = null;
    if (start <= 1) {
      await setJob(jobId, { stage: "SCRIPT", progress: 35 });
      const primary = plans.get(ratios[0]!)!;
      if (format.uses.vo) {
        let attempt = 0;
        let rejected: string | null = "init";
        while (rejected && attempt < 3) {
          const built = buildScriptDeterministic({
            recipe,
            plan: primary,
            pack,
            forceWordy: false,
          });
          const checked = enforceScript(built, pack, recipe.duration_s);
          rejected = checked.rejected;
          if (!rejected) script = checked.script;
          attempt += 1;
        }
        if (!script) throw new Error("script word-budget/avoid failed after retries");
      } else {
        script = buildScriptDeterministic({ recipe, plan: primary, pack });
        script = { ...script, lines: [], total_words: 0 };
      }
      await db
        .insert(scriptsTable)
        .values({ recipeId: recipe.id, payload: script })
        .onConflictDoUpdate({ target: scriptsTable.recipeId, set: { payload: script } });
    } else {
      const row = (await db.select().from(scriptsTable).where(eq(scriptsTable.recipeId, recipe.id)))[0];
      script = row ? Script.parse(row.payload) : null;
    }

    const sourcePath = path.resolve(process.cwd(), "data/media", `${title.id}.mp4`);
    const timelines = new Map<Ratio, Timeline>();
    if (start <= 2) {
      await setJob(jobId, { stage: "ASSEMBLE", progress: 55 });
      for (const ratio of ratios) {
        const plan = plans.get(ratio)!;
        const tl = await assembleRatio({
          recipe,
          plan,
          script,
          evidence: intel.evidence,
          title,
          sourcePath,
        });
        timelines.set(ratio, tl);
        await db
          .insert(timelinesTable)
          .values({ recipeId: recipe.id, ratio, payload: tl })
          .onConflictDoUpdate({
            target: [timelinesTable.recipeId, timelinesTable.ratio],
            set: { payload: tl },
          });
        await storage.put(
          `timelines/${recipe.id}/${ratioFileToken(ratio)}.json`,
          JSON.stringify(tl, null, 2),
        );
      }
    } else {
      for (const ratio of ratios) {
        const row = (await db.select().from(timelinesTable)).find(
          (p) => p.recipeId === recipe.id && p.ratio === ratio,
        );
        if (!row) throw new Error(`timeline missing ${ratio}`);
        timelines.set(ratio, Timeline.parse(row.payload));
      }
    }

    if (start <= 3) {
      await setJob(jobId, { stage: "COMPOSE", progress: 75 });
      for (const ratio of ratios) {
        const tl = timelines.get(ratio)!;
        const outKey = `renders/${recipe.id}/${ratioFileToken(ratio)}.mp4`;
        await composeTimeline({ timeline: tl, outKey });
        await storage.put(
          `renders/${recipe.id}/${ratioFileToken(ratio)}.filtergraph.json`,
          JSON.stringify(filtergraphSnapshot(tl), null, 2),
        );
      }
    }

    await setJob(jobId, { stage: "QC", progress: 90 });
    const cost = await costMeter.total(recipe.id);
    const breakdown = await costMeter.breakdown(recipe.id);
    for (const ratio of ratios) {
      const tl = timelines.get(ratio)!;
      const plan = plans.get(ratio)!;
      const filePath = storage.abs(`renders/${recipe.id}/${ratioFileToken(ratio)}.mp4`);
      const det = await runDeterministicQc({
        filePath,
        timeline: tl,
        plan,
        recipe,
        evidence: intel.evidence,
        spoilerBoundary: title.spoiler_boundary_ms,
        script,
        pack,
        costInr: cost,
      });
      const intended = script?.lines.map((l) => l.text).join(" ") ?? "";
      let transcript = intended;
      if (!process.env.SNAPSHOT_MODE || intended) {
        const asr = await getVertex().transcribeAudio({ assetPath: filePath, recipeId: recipe.id });
        if (asr.text) transcript = asr.text;
      }
      if (!transcript) transcript = intended;
      const judge = await runAiJudge({
        filePath,
        transcript,
        intendedScript: intended,
        evidence: intel.evidence.filter((e) =>
          plan.beats.some((b) => b.evidence_ids.includes(e.id)),
        ),
        title,
        recipeId: recipe.id,
      });
      const promoId = `prm_${recipe.id}_${ratioFileToken(ratio)}`;
      const row = LedgerRow.parse({
        promo_id: promoId,
        recipe_id: recipe.id,
        title_id: title.id,
        format: recipe.format,
        dialect: recipe.dialect,
        ratio,
        created_at: nowIso(),
        cost_inr: cost,
        cost_breakdown: breakdown,
        wall_ms: Date.now() - t0,
        qc_deterministic_pass: det.pass,
        qc_ai_scores: {
          A5: judge.A5_dialect_match,
          A6: judge.A6_hook_strength,
          A7: judge.A7_pacing,
          A8: judge.A8_overall_craft,
        },
        editor_verdict: null,
        editor_reason_codes: [],
        editor_edit_minutes: null,
        published_at: null,
        impressions: null,
        view_rate_3s: null,
        completion_rate: null,
        ctr_to_title: null,
      });
      await upsertLedger(row);
      await storage.put(
        `qc/${recipe.id}/${ratioFileToken(ratio)}.json`,
        JSON.stringify({ det, judge, asr_similarity: levenshteinRatio(transcript, intended) }, null, 2),
      );
    }

    await setJob(jobId, {
      status: "completed",
      stage: "QC",
      progress: 100,
      costInr: cost,
      error: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await setJob(jobId, { status: "failed", error: msg });
    throw e;
  }
}

export async function enqueueJob(recipeId: string): Promise<string> {
  const jobId = id("job");
  await db.insert(jobs).values({
    id: jobId,
    recipeId,
    status: "queued",
    stage: "PLAN",
    progress: 0,
    costInr: 0,
    error: null,
    cancelRequested: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return jobId;
}
