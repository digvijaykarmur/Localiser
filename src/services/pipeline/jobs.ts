import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { PromoError, PIPELINE_ORDER, type JobStage } from "@/domain";
import { storage } from "@/providers";
import { rowToRecipe } from "../recipes";

export async function getJobView(jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new PromoError("NOT_FOUND", `Job ${jobId} not found`);
  const recipe = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, job.recipeId) });
  const title = recipe ? await db.query.titles.findFirst({ where: eq(schema.titles.id, recipe.titleId) }) : null;
  const angle = recipe ? await db.query.angles.findFirst({ where: eq(schema.angles.id, recipe.angleId) }) : null;
  const artifacts = await db.query.artifacts.findMany({ where: eq(schema.artifacts.jobId, jobId), orderBy: desc(schema.artifacts.createdAt) });
  const assets = await db.query.assets.findMany({ where: eq(schema.assets.jobId, jobId) });
  const promo = job.promoId ? await db.query.promos.findFirst({ where: eq(schema.promos.id, job.promoId) }) : null;
  const st = storage();

  const byKind = (kind: string) => artifacts.filter((a) => a.kind === kind);
  const renders: Record<string, string> = {};
  for (const r of byKind("render")) if (r.ratio && r.storageKey) renders[r.ratio] = await st.url(r.storageKey);

  const stageIndex = PIPELINE_ORDER.indexOf(job.stage as JobStage);
  type StageState = "queued" | "running" | "done" | "failed" | "waiting-provider";
  const stages = PIPELINE_ORDER.map((s, i) => ({
    stage: s,
    state: (job.stage === "READY" ? "done" : job.stage === "FAILED" || job.stage === "CANCELLED" ? (i < stageIndex ? "done" : i === stageIndex ? "failed" : "queued") : job.stage === "WAITING_PROVIDER" ? (s === job.resumeStage ? "waiting-provider" : i < PIPELINE_ORDER.indexOf(job.resumeStage as JobStage) ? "done" : "queued") : i < stageIndex ? "done" : i === stageIndex ? "running" : "queued") as StageState,
    timing: (() => {
      const t = job.stageTimings?.[s];
      if (!t) return null;
      const ms = t.finished_at ? new Date(t.finished_at).getTime() - new Date(t.started_at).getTime() : undefined;
      return { ...t, ms };
    })(),
  }));
  if (job.stage === "FAILED" && (job.error as { code?: string } | null)?.code === "QC_GATE") stages[stages.length - 1]!.state = "failed";

  return {
    id: job.id,
    stage: job.stage,
    resume_stage: job.resumeStage,
    error: job.error,
    cost_spent_inr: Number(job.costSpentInr),
    cost_breakdown: job.costBreakdown,
    cost_envelope_inr: recipe?.costEnvelopeInr ?? null,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    promo_id: job.promoId,
    promo: promo ? { id: promo.id, status: promo.status, verdict: promo.verdict, reason_codes: promo.reasonCodes, edit_minutes: promo.editMinutes, note: promo.note } : null,
    recipe: recipe ? rowToRecipe(recipe) : null,
    title: title ? { id: title.id, name: title.name, name_native: title.nameNative, dialect: title.dialect } : null,
    angle: angle ? { id: angle.id, claim: angle.claim, kind: angle.kind } : null,
    stages,
    plans: Object.fromEntries(byKind("plan").map((a) => [a.ratio!, a.payload])),
    script: byKind("script")[0]?.payload ?? null,
    timelines: Object.fromEntries(byKind("timeline").map((a) => [a.ratio!, a.payload])),
    renders,
    qc: Object.fromEntries(byKind("qc").map((a) => [a.ratio!, a.payload])),
    assets: assets.map((a) => ({ id: a.id, kind: a.kind, ratio: a.ratio, duration_ms: a.durationMs, ai_generated: a.aiGenerated, provenance: a.provenance })),
    raw_outputs: artifacts.filter((a) => a.kind === "raw_model_output").map((a) => a.storageKey),
  };
}

export async function listJobs(limit = 50) {
  const rows = await db.query.jobs.findMany({ orderBy: desc(schema.jobs.createdAt), limit });
  const recipeIds = [...new Set(rows.map((r) => r.recipeId))];
  const recipes = recipeIds.length ? await db.query.recipes.findMany({ where: (t, { inArray }) => inArray(t.id, recipeIds) }) : [];
  const titles = await db.query.titles.findMany();
  const rmap = new Map(recipes.map((r) => [r.id, r]));
  const tmap = new Map(titles.map((t) => [t.id, t]));
  return rows.map((j) => {
    const r = rmap.get(j.recipeId);
    const t = r ? tmap.get(r.titleId) : undefined;
    return { id: j.id, stage: j.stage, promo_id: j.promoId, cost_spent_inr: Number(j.costSpentInr), created_at: j.createdAt.toISOString(), format: r?.format ?? null, dialect: r?.dialect ?? null, duration_s: r?.durationS ?? null, title: t ? { id: t.id, name: t.name } : null, error: j.error };
  });
}
