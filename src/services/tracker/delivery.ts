import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { DeliveryManifest, PromoError, QCReport, ScheduleRequest, type Ratio } from "@/domain";
import { ffprobeJson } from "@/lib/ffmpeg";
import { keys, storage } from "@/providers";
import { latestArtifact } from "../pipeline";
import { rowToRecipe } from "../recipes";
import type { z } from "zod";

/** Delivery queue gate (§12, §30): approved, all ratios present, all QC gates passed, provenance complete. */
export async function deliveryGate(promoId: string) {
  const promo = await db.query.promos.findFirst({ where: eq(schema.promos.id, promoId) });
  if (!promo) throw new PromoError("NOT_FOUND", `Promo ${promoId} not found`);
  const recipeRow = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, promo.recipeId) });
  if (!recipeRow) throw new PromoError("NOT_FOUND", `Recipe ${promo.recipeId} not found`);
  const recipe = rowToRecipe(recipeRow);
  const problems: string[] = [];
  if (!["APPROVED", "SCHEDULED", "PUBLISHED", "MEASURED"].includes(promo.status)) problems.push(`Verdict is ${promo.verdict ?? "missing"}; only approved promos enter delivery.`);

  const renders: Record<string, string> = {};
  for (const r of recipe.ratios) {
    const art = await latestArtifact(promo.jobId, "render", r);
    if (!art?.storageKey) problems.push(`Render for ${r} is missing.`);
    else renders[r] = art.storageKey;
    const qc = await latestArtifact(promo.jobId, "qc", r);
    if (!qc) problems.push(`QC report for ${r} is missing.`);
    else {
      const report = QCReport.parse(qc.payload);
      if (!report.gate_pass) problems.push(`QC gate failed for ${r}.`);
    }
  }
  const assets = await db.query.assets.findMany({ where: eq(schema.assets.jobId, promo.jobId) });
  for (const a of assets) {
    const p = a.provenance;
    if (!p || !p.provider || !p.input_hash) problems.push(`Asset ${a.id} (${a.kind}) has incomplete provenance.`);
  }
  const aiByClass: Record<string, boolean> = {};
  for (const a of assets) aiByClass[a.kind] = (aiByClass[a.kind] ?? false) || a.aiGenerated;
  const aiGenerated = Object.values(aiByClass).some(Boolean);
  return { promo, recipe, renders, assets, problems, ok: problems.length === 0, ai_generated: aiGenerated, ai_generated_by_asset_class: aiByClass };
}

export async function schedulePromo(promoId: string, body: z.infer<typeof ScheduleRequest>) {
  const req = ScheduleRequest.parse(body);
  const gate = await deliveryGate(promoId);
  if (!gate.ok) throw new PromoError("INVALID_TRANSITION", gate.problems.join(" "), { detail: { problems: gate.problems }, recovery: "Resolve every listed gate before scheduling." });
  await db.update(schema.promos).set({ status: "SCHEDULED", channel: req.channel, scheduledAt: new Date(req.scheduled_at) }).where(eq(schema.promos.id, promoId));
  await db.update(schema.slots).set({ status: "SCHEDULED" }).where(eq(schema.slots.promoId, promoId));
  return deliveryView(promoId);
}

/**
 * Export bundle (§12 step 3–4, §30): `{promo_id}_{ratio}.mp4` ×N + manifest.json. The promo_id
 * is already in the mp4 comment metadata from the composer; this verifies it survived the file
 * copy (§30.2) before the bundle is handed to a publisher.
 */
export async function deliverPromo(promoId: string) {
  const gate = await deliveryGate(promoId);
  if (!gate.ok) throw new PromoError("INVALID_TRANSITION", gate.problems.join(" "), { detail: { problems: gate.problems }, recovery: "Resolve every listed gate before delivering." });
  if (gate.promo.status !== "SCHEDULED" && gate.promo.status !== "PUBLISHED" && gate.promo.status !== "MEASURED")
    throw new PromoError("INVALID_TRANSITION", `Promo ${promoId} is ${gate.promo.status}; assign a channel and datetime first.`, { recovery: "POST /promos/:id/schedule before /deliver." });

  const st = storage();
  const title = await db.query.titles.findFirst({ where: eq(schema.titles.id, gate.recipe.title_id) });
  const angle = await db.query.angles.findFirst({ where: eq(schema.angles.id, gate.recipe.angle_id) });
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, gate.promo.jobId) });
  const plans = await db.query.artifacts.findMany({ where: eq(schema.artifacts.jobId, gate.promo.jobId) });
  const evidenceIds = new Set<string>();
  for (const a of plans.filter((p) => p.kind === "plan")) {
    const beats = (a.payload as { beats?: { evidence_ids: string[] }[] }).beats ?? [];
    for (const b of beats) for (const e of b.evidence_ids) evidenceIds.add(e);
  }

  const files: Record<string, string> = {};
  const exportKeys: Record<string, string> = {};
  for (const [ratio, key] of Object.entries(gate.renders)) {
    const name = `${promoId}_${ratio.replace(":", "x")}.mp4`;
    const outKey = keys.export(promoId, name);
    await st.put(outKey, await st.get(key), "video/mp4");
    const probe = await ffprobeJson(await st.localPath(outKey));
    const comment = String(probe.format?.tags?.comment ?? "");
    if (!comment.includes(`promo_id=${promoId}`))
      throw new PromoError("ASSUMPTION_VIOLATED", `promo_id did not survive export for ${ratio}: comment tag is "${comment}".`, { recovery: "Check renderTimeline metadata flags; the measurement loop depends on this (§30.2)." });
    files[ratio] = name;
    exportKeys[ratio] = outKey;
  }

  const manifest = DeliveryManifest.parse({
    promo_id: promoId,
    title: { id: title?.id ?? gate.recipe.title_id, name: title?.name ?? "", name_native: title?.nameNative ?? "" },
    claim: angle?.claim ?? "",
    evidence_ids: [...evidenceIds].sort(),
    dialect: gate.recipe.dialect,
    dialect_pack_version: gate.recipe.dialect_pack_version,
    prompt_versions: gate.recipe.prompt_versions,
    format: gate.recipe.format,
    cost_inr: Number(job?.costSpentInr ?? 0),
    ratios: Object.keys(files),
    files,
    ai_generated: gate.ai_generated,
    ai_generated_by_asset_class: gate.ai_generated_by_asset_class,
    channel: gate.promo.channel,
    scheduled_at: gate.promo.scheduledAt?.toISOString() ?? null,
    exported_at: new Date().toISOString(),
  });
  const manifestKey = keys.export(promoId, "manifest.json");
  await st.put(manifestKey, Buffer.from(JSON.stringify(manifest, null, 2)), "application/json");
  exportKeys.manifest = manifestKey;

  await db.update(schema.promos).set({ deliveredAt: new Date(), exportKeys }).where(eq(schema.promos.id, promoId));
  return deliveryView(promoId);
}

/** Publishing is manual in v1 (§12 step 5); the operator records that it happened. */
export async function markPublished(promoId: string, publishedAt: Date = new Date()) {
  const promo = await db.query.promos.findFirst({ where: eq(schema.promos.id, promoId) });
  if (!promo) throw new PromoError("NOT_FOUND", `Promo ${promoId} not found`);
  if (!promo.deliveredAt) throw new PromoError("INVALID_TRANSITION", `Promo ${promoId} has not been exported. Deliver first so the bundle exists.`);
  await db.update(schema.promos).set({ status: "PUBLISHED", publishedAt }).where(eq(schema.promos.id, promoId));
  await db.update(schema.ledger).set({ publishedAt }).where(eq(schema.ledger.promoId, promoId));
  await db.update(schema.slots).set({ status: "PUBLISHED" }).where(eq(schema.slots.promoId, promoId));
  return deliveryView(promoId);
}

export async function deliveryView(promoId: string) {
  const gate = await deliveryGate(promoId);
  const st = storage();
  const exportUrls: Record<string, string> = {};
  for (const [k, key] of Object.entries(gate.promo.exportKeys ?? {})) exportUrls[k] = await st.url(key);
  let manifest: DeliveryManifest | null = null;
  if (gate.promo.exportKeys?.manifest) manifest = DeliveryManifest.parse(JSON.parse((await st.get(gate.promo.exportKeys.manifest)).toString("utf8")));
  return {
    promo_id: promoId,
    status: gate.promo.status,
    verdict: gate.promo.verdict,
    channel: gate.promo.channel,
    scheduled_at: gate.promo.scheduledAt?.toISOString() ?? null,
    delivered_at: gate.promo.deliveredAt?.toISOString() ?? null,
    published_at: gate.promo.publishedAt?.toISOString() ?? null,
    ratios: gate.recipe.ratios as Ratio[],
    gate: { ok: gate.ok, problems: gate.problems },
    ai_generated: gate.ai_generated,
    ai_generated_by_asset_class: gate.ai_generated_by_asset_class,
    exports: exportUrls,
    manifest,
  };
}

/** Delivery queue: everything approved but not yet published, newest first. */
export async function deliveryQueue() {
  const rows = await db.query.promos.findMany({ where: inArray(schema.promos.status, ["APPROVED", "SCHEDULED"]), orderBy: desc(schema.promos.reviewedAt) });
  const out = [];
  for (const p of rows) {
    const recipe = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, p.recipeId) });
    const title = await db.query.titles.findFirst({ where: eq(schema.titles.id, p.titleId) });
    out.push({ promo_id: p.id, job_id: p.jobId, status: p.status, channel: p.channel, scheduled_at: p.scheduledAt?.toISOString() ?? null, delivered_at: p.deliveredAt?.toISOString() ?? null, format: recipe?.format ?? null, dialect: recipe?.dialect ?? null, title: title ? { id: title.id, name: title.name } : null });
  }
  return out;
}
