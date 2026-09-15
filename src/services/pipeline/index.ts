import fs from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  flattenJudge,
  PIPELINE_ORDER,
  PromoError,
  PromoPlan,
  QCReport,
  Script,
  Timeline,
  toErrorJSON,
  type Angle,
  type DialectPack,
  type EvidenceUnit,
  type FormatPolicy,
  type JobStage,
  type Ratio,
  type Recipe,
  type RetryFromStage,
  type Title,
} from "@/domain";
import { hashInputs } from "@/lib/hash";
import { ids } from "@/lib/ids";
import { log } from "@/lib/log";
import { keys, storage } from "@/providers";
import { assemble, loadAssets } from "../assembler";
import { buildTimeline, renderTimeline } from "../composer";
import { CostMeter } from "../cost/meter";
import { loadPackVersion } from "../dialects";
import { loadFormat } from "../formats";
import { writeLedgerRow } from "../ledger";
import { buildPlan } from "../planner";
import { eligibleEvidence, getRecipe } from "../recipes";
import { runDeterministicChecks, runJudge } from "../qc";
import { buildScript, sourceOnlyScript } from "../scripter";
import { getAngle, getEvidence, getTitle } from "../titles";
import { enqueueStage } from "./queue";

const logger = log("pipeline");

export interface JobContext {
  jobId: string;
  promoId: string;
  recipe: Recipe;
  title: Title;
  angle: Angle;
  evidence: EvidenceUnit[]; // eligible
  evidenceMap: Map<string, EvidenceUnit>; // all units of the title
  pack: DialectPack;
  policy: FormatPolicy;
  meter: CostMeter;
}

export async function loadJobContext(jobId: string): Promise<JobContext> {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new PromoError("NOT_FOUND", `Job ${jobId} not found`);
  const recipe = await getRecipe(job.recipeId);
  const title = await getTitle(recipe.title_id);
  const angle = await getAngle(recipe.angle_id);
  const all = await getEvidence(recipe.title_id);
  const pack = await loadPackVersion(recipe.dialect, recipe.dialect_pack_version);
  const policy = loadFormat(recipe.format);
  return {
    jobId,
    promoId: job.promoId!,
    recipe,
    title,
    angle,
    evidence: eligibleEvidence(all, title, recipe.source_window),
    evidenceMap: new Map(all.map((e) => [e.id, e])),
    pack,
    policy,
    meter: new CostMeter(jobId, recipe.id, recipe.cost_envelope_inr),
  };
}

// --- artifacts ------------------------------------------------------------------------------

async function findArtifact(jobId: string, stage: string, ratio: string | null, inputHash: string) {
  return db.query.artifacts.findFirst({
    where: and(eq(schema.artifacts.jobId, jobId), eq(schema.artifacts.stage, stage), ratio === null ? eq(schema.artifacts.kind, schema.artifacts.kind) : eq(schema.artifacts.ratio, ratio), eq(schema.artifacts.inputHash, inputHash)),
  });
}

async function saveArtifact(a: { jobId: string; stage: string; ratio: string | null; kind: string; payload?: unknown; storageKey?: string | null; inputHash: string }) {
  await db
    .insert(schema.artifacts)
    .values({ id: ids.artifact(), jobId: a.jobId, stage: a.stage, ratio: a.ratio, kind: a.kind, payload: a.payload ?? null, storageKey: a.storageKey ?? null, inputHash: a.inputHash })
    .onConflictDoNothing();
}

export async function latestArtifact(jobId: string, kind: string, ratio?: string | null) {
  const rows = await db.query.artifacts.findMany({ where: and(eq(schema.artifacts.jobId, jobId), eq(schema.artifacts.kind, kind), ratio ? eq(schema.artifacts.ratio, ratio) : undefined) });
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0] ?? null;
}

export async function loadPlans(jobId: string, ratios: Ratio[]): Promise<Record<string, PromoPlan>> {
  const out: Record<string, PromoPlan> = {};
  for (const r of ratios) {
    const a = await latestArtifact(jobId, "plan", r);
    if (!a) throw new PromoError("INVALID_TRANSITION", `No plan artifact for ${r}; retry from PLAN`);
    out[r] = PromoPlan.parse(a.payload);
  }
  return out;
}

export async function loadScript(jobId: string): Promise<Script> {
  const a = await latestArtifact(jobId, "script");
  if (!a) throw new PromoError("INVALID_TRANSITION", "No script artifact; retry from SCRIPT");
  return Script.parse(a.payload);
}

// --- job state ------------------------------------------------------------------------------

async function setStage(jobId: string, stage: JobStage, extra: Partial<typeof schema.jobs.$inferInsert> = {}) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  const timings = { ...(job?.stageTimings ?? {}) };
  const now = new Date().toISOString();
  if (job?.stage && timings[job.stage] && !timings[job.stage]!.finished_at) timings[job.stage]!.finished_at = now;
  if (PIPELINE_ORDER.includes(stage)) timings[stage] = { started_at: now };
  await db.update(schema.jobs).set({ stage, stageTimings: timings, ...extra }).where(eq(schema.jobs.id, jobId));
}

export async function createJob(recipeId: string): Promise<{ jobId: string; promoId: string }> {
  await getRecipe(recipeId);
  const jobId = ids.job();
  const promoId = ids.promo();
  await db.insert(schema.jobs).values({ id: jobId, recipeId, stage: "QUEUED", promoId, startedAt: new Date() });
  await enqueueStage(jobId, "PLAN");
  return { jobId, promoId };
}

function nextStage(stage: JobStage): JobStage | null {
  const i = PIPELINE_ORDER.indexOf(stage);
  return i >= 0 && i < PIPELINE_ORDER.length - 1 ? PIPELINE_ORDER[i + 1]! : null;
}

/** Retry from an earlier stage reusing all earlier artifacts (§9, §25). COMPOSE retries are free. */
export async function retryJob(jobId: string, from: RetryFromStage): Promise<void> {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new PromoError("NOT_FOUND", `Job ${jobId} not found`);
  const idx = PIPELINE_ORDER.indexOf(from);
  const stagesToClear = PIPELINE_ORDER.slice(idx);
  await db.delete(schema.artifacts).where(and(eq(schema.artifacts.jobId, jobId), inArray(schema.artifacts.stage, stagesToClear)));
  if (job.promoId) await db.delete(schema.promos).where(eq(schema.promos.id, job.promoId));
  await setStage(jobId, from, { error: null, finishedAt: null });
  await enqueueStage(jobId, from, { nonce: Date.now().toString(36) });
}

export async function cancelJob(jobId: string): Promise<void> {
  await setStage(jobId, "CANCELLED", { finishedAt: new Date() });
}

// --- stage runners ---------------------------------------------------------------------------

export async function runStage(jobId: string, stage: JobStage): Promise<{ next: JobStage | null }> {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new PromoError("NOT_FOUND", `Job ${jobId} not found`);
  if (job.stage === "CANCELLED") return { next: null };
  const ctx = await loadJobContext(jobId);
  await setStage(jobId, stage, { error: null });
  logger.info("stage start", { jobId, stage });
  try {
    switch (stage) {
      case "PLAN":
        await stagePlan(ctx);
        break;
      case "SCRIPT":
        await stageScript(ctx);
        break;
      case "ASSEMBLE":
        await stageAssemble(ctx);
        break;
      case "COMPOSE":
        await stageCompose(ctx);
        break;
      case "QC":
        await stageQc(ctx);
        return { next: null };
      default:
        throw new PromoError("INVALID_TRANSITION", `Cannot run stage ${stage}`);
    }
  } catch (e) {
    if (e instanceof PromoError && e.retryable) {
      await setStage(jobId, "WAITING_PROVIDER", { resumeStage: stage, error: toErrorJSON(e) });
      throw e; // BullMQ retries with backoff; job resumes automatically
    }
    await setStage(jobId, "FAILED", { error: toErrorJSON(e), finishedAt: new Date() });
    logger.error("stage failed", { jobId, stage, error: toErrorJSON(e).message });
    return { next: null };
  }
  const next = nextStage(stage);
  if (next) await enqueueStage(jobId, next);
  return { next };
}

async function stagePlan(ctx: JobContext) {
  const ratios = orderRatios(ctx.recipe.ratios);
  let reference: PromoPlan | null = null;
  for (const ratio of ratios) {
    const inputHash = hashInputs("plan", ctx.recipe.id, ratio, ctx.evidence.map((e) => e.id), ctx.pack.version, ctx.recipe.prompt_versions.plan, reference?.beats.map((b) => b.evidence_ids));
    const cached = await findArtifact(ctx.jobId, "PLAN", ratio, inputHash);
    let plan: PromoPlan;
    if (cached) plan = PromoPlan.parse(cached.payload);
    else {
      const r = await buildPlan({ ...ctx, reference }, ratio);
      plan = r.plan;
      await saveArtifact({ jobId: ctx.jobId, stage: "PLAN", ratio, kind: "plan", payload: plan, inputHash });
    }
    if (!reference) reference = plan;
  }
}

async function stageScript(ctx: JobContext) {
  const ratios = orderRatios(ctx.recipe.ratios);
  const plans = await loadPlans(ctx.jobId, ratios);
  const refPlan = plans[ratios[0]!]!;
  const inputHash = hashInputs("script", ctx.recipe.id, refPlan.beats.map((b) => [b.index, b.role, b.evidence_ids]), ctx.pack.version, ctx.recipe.prompt_versions.script ?? "none");
  if (await findArtifact(ctx.jobId, "SCRIPT", null, inputHash)) return;
  let script: Script;
  if (ctx.policy.has_vo) {
    const r = await buildScript({ recipe: ctx.recipe, title: ctx.title, plan: refPlan, evidence: ctx.evidenceMap, pack: ctx.pack, policy: ctx.policy, meter: ctx.meter, jobId: ctx.jobId, claim: ctx.angle.claim });
    script = r.script;
  } else script = sourceOnlyScript(ctx.recipe, refPlan, ctx.evidenceMap, ctx.pack, ctx.title.name_native);
  await saveArtifact({ jobId: ctx.jobId, stage: "SCRIPT", ratio: null, kind: "script", payload: script, inputHash });
}

async function stageAssemble(ctx: JobContext) {
  const plans = await loadPlans(ctx.jobId, orderRatios(ctx.recipe.ratios));
  const script = await loadScript(ctx.jobId);
  await assemble({ jobId: ctx.jobId, recipe: ctx.recipe, title: ctx.title, plans, script, evidence: ctx.evidenceMap, pack: ctx.pack, policy: ctx.policy, meter: ctx.meter });
}

async function stageCompose(ctx: JobContext) {
  const ratios = orderRatios(ctx.recipe.ratios);
  const plans = await loadPlans(ctx.jobId, ratios);
  const script = await loadScript(ctx.jobId);
  const { refs, paths } = await loadAssets(ctx.jobId);
  const st = storage();
  for (const ratio of ratios) {
    const timeline = buildTimeline({ plan: plans[ratio]!, script, assets: refs, evidence: ctx.evidenceMap, policy: ctx.policy, ratio });
    const inputHash = hashInputs("compose", timeline, [...paths.keys()].sort(), ctx.promoId);
    // timeline and render share the idempotency tuple except for the hash; keep them distinct rows
    const renderHash = hashInputs("render", inputHash);
    const cachedRender = await findArtifact(ctx.jobId, "COMPOSE", ratio, renderHash);
    if (cachedRender?.kind === "render" && cachedRender.storageKey && (await st.exists(cachedRender.storageKey))) continue;
    await db.delete(schema.artifacts).where(and(eq(schema.artifacts.jobId, ctx.jobId), eq(schema.artifacts.stage, "COMPOSE"), eq(schema.artifacts.ratio, ratio)));
    await saveArtifact({ jobId: ctx.jobId, stage: "COMPOSE", ratio, kind: "timeline", payload: timeline, inputHash });
    const rawKey = keys.renderRaw(ctx.jobId, ratio);
    const finalKey = keys.render(ctx.jobId, ratio);
    const rawOut = await st.localPath(rawKey);
    const finalOut = await st.localPath(finalKey);
    try {
      const r = await renderTimeline(timeline, paths, { rawOut, finalOut, promoId: ctx.promoId });
      await saveArtifact({ jobId: ctx.jobId, stage: "COMPOSE", ratio, kind: "render", payload: { args: r.args, loudness: r.loudness, storage_key: finalKey }, storageKey: finalKey, inputHash: renderHash });
    } catch (e) {
      // render failure is legible: stderr + the Timeline that produced it (§13)
      if (e instanceof PromoError) e.detail.timeline = timeline;
      throw e;
    } finally {
      fs.rmSync(rawOut, { force: true });
    }
  }
}

async function stageQc(ctx: JobContext) {
  const ratios = orderRatios(ctx.recipe.ratios);
  const plans = await loadPlans(ctx.jobId, ratios);
  const script = await loadScript(ctx.jobId);
  const { rows, paths } = await loadAssets(ctx.jobId);
  const st = storage();
  const job = (await db.query.jobs.findFirst({ where: eq(schema.jobs.id, ctx.jobId) }))!;
  const startedAt = job.startedAt ?? job.createdAt;
  const reports: QCReport[] = [];
  const assetRows = rows.map((r) => ({ id: r.id, kind: r.kind, storageKey: r.storageKey, provenance: r.provenance, localPath: paths.get(r.id)! }));

  for (const ratio of ratios) {
    const tlArt = await latestArtifact(ctx.jobId, "timeline", ratio);
    const renderArt = await latestArtifact(ctx.jobId, "render", ratio);
    if (!tlArt || !renderArt?.storageKey) throw new PromoError("INVALID_TRANSITION", `No render for ${ratio}; retry from COMPOSE`);
    const timeline = Timeline.parse(tlArt.payload);
    const renderPath = await st.localPath(renderArt.storageKey);
    const { total: costSpent } = await ctx.meter.spent();
    const det = await runDeterministicChecks({ ratio, renderPath, timeline, plan: plans[ratio]!, script, recipe: ctx.recipe, title: ctx.title, evidence: ctx.evidenceMap, assetRows, costSpentInr: costSpent });
    let ai = null;
    if (det.all_pass) {
      ai = await runJudge({ jobId: ctx.jobId, ratio, renderPath, recipe: ctx.recipe, title: ctx.title, plan: plans[ratio]!, script, evidence: ctx.evidenceMap, meter: ctx.meter, hasVo: ctx.policy.has_vo, dialectName: ctx.pack.name });
    }
    const report = QCReport.parse({ ratio, deterministic: det, ai, gate_pass: det.all_pass && (ai?.gates_pass ?? false) });
    reports.push(report);
    await saveArtifact({ jobId: ctx.jobId, stage: "QC", ratio, kind: "qc", payload: report, inputHash: hashInputs("qc", ctx.jobId, ratio, renderArt.inputHash) });
  }

  const { total, breakdown } = await ctx.meter.spent();
  const wallMs = Date.now() - startedAt.getTime();
  for (const r of reports) {
    await writeLedgerRow({
      promoId: ctx.promoId,
      ratio: r.ratio as Ratio,
      recipeId: ctx.recipe.id,
      titleId: ctx.recipe.title_id,
      format: ctx.recipe.format,
      dialect: ctx.recipe.dialect,
      costInr: total,
      costBreakdown: breakdown,
      wallMs,
      qcDeterministic: Object.fromEntries(r.deterministic.checks.map((c) => [c.id, c.pass])),
      qcAi: flattenJudge(r.ai),
    });
  }

  const allPass = reports.every((r) => r.gate_pass);
  if (allPass) {
    await db
      .insert(schema.promos)
      .values({ id: ctx.promoId, jobId: ctx.jobId, recipeId: ctx.recipe.id, titleId: ctx.recipe.title_id, status: "AWAITING_REVIEW" })
      .onConflictDoUpdate({ target: schema.promos.id, set: { status: "AWAITING_REVIEW", verdict: null, reasonCodes: [], editMinutes: null, note: null } });
    await setStage(ctx.jobId, "READY", { finishedAt: new Date() });
  } else {
    const failed = reports.flatMap((r) => [
      ...r.deterministic.checks.filter((c) => !c.pass).map((c) => `${r.ratio} ${c.id}: ${c.detail}`),
      ...(r.ai && !r.ai.gates_pass ? Object.entries(r.ai.judge).filter(([k, v]) => /^A[1-4]/.test(k) && "pass" in v && !(v as { pass: boolean }).pass).map(([k, v]) => `${r.ratio} ${k}: ${(v as { evidence: string }).evidence}`) : []),
    ]);
    await setStage(ctx.jobId, "FAILED", {
      finishedAt: new Date(),
      error: { code: "QC_GATE", message: `QC gate failed on ${failed.length} check${failed.length === 1 ? "" : "s"}. No reviewer sees this promo.`, detail: { failed }, recovery: "Fix the cause and retry from the stage that owns it (COMPOSE is free)." },
    });
  }
}

/** 16:9 is planned first so the shared script is written against it (§17.4). */
export function orderRatios(ratios: Ratio[]): Ratio[] {
  return [...ratios].sort((a, b) => (a === "16:9" ? -1 : b === "16:9" ? 1 : a.localeCompare(b)));
}
