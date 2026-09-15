import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Campaign, CampaignRequest, PromoError, Slot, SlotCreateRequest, SlotFillRequest, type DialectCode, type FormatCode, type SlotStatus } from "@/domain";
import { ids } from "@/lib/ids";
import { createJob } from "../pipeline";
import { createRecipe, getPreset, previewRecipe } from "../recipes";
import { getAngles, getTitle } from "../titles";
import type { z } from "zod";

function rowToCampaign(r: typeof schema.campaigns.$inferSelect): Campaign {
  return Campaign.parse({ id: r.id, name: r.name, channel: r.channel, week_start: r.weekStart, budget_inr: r.budgetInr, created_at: r.createdAt.toISOString() });
}

function rowToSlot(r: typeof schema.slots.$inferSelect): Slot {
  return Slot.parse({ id: r.id, campaign_id: r.campaignId, date: r.date, intended_format: r.intendedFormat, title_id: r.titleId, recipe_id: r.recipeId, promo_id: r.promoId, job_id: r.jobId, status: r.status });
}

export async function listCampaigns() {
  const rows = await db.query.campaigns.findMany({ orderBy: desc(schema.campaigns.weekStart) });
  const out = [];
  for (const r of rows) out.push(await campaignView(r.id));
  return out;
}

export async function createCampaign(body: z.infer<typeof CampaignRequest>) {
  const req = CampaignRequest.parse(body);
  const id = ids.campaign();
  await db.insert(schema.campaigns).values({ id, name: req.name, channel: req.channel, weekStart: req.week_start, budgetInr: req.budget_inr });
  // A campaign is a week of visible gaps: one empty CP slot per weekday until the producer says otherwise.
  const start = new Date(`${req.week_start}T00:00:00Z`);
  for (let d = 0; d < 5; d++) {
    const date = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
    await db.insert(schema.slots).values({ id: ids.slot(), campaignId: id, date, intendedFormat: "CP", status: "EMPTY" });
  }
  return campaignView(id);
}

/** Slot statuses are derived from the live job/promo where one exists, so the calendar never lies. */
async function liveStatus(s: typeof schema.slots.$inferSelect): Promise<SlotStatus> {
  if (s.promoId) {
    const p = await db.query.promos.findFirst({ where: eq(schema.promos.id, s.promoId) });
    if (p) {
      if (p.status === "MEASURED") return "MEASURED";
      if (p.status === "PUBLISHED") return "PUBLISHED";
      if (p.status === "SCHEDULED") return "SCHEDULED";
      if (p.status === "APPROVED") return "APPROVED";
      return "AWAITING_REVIEW";
    }
  }
  if (s.jobId) {
    const j = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, s.jobId) });
    if (j && j.stage !== "READY") return "GENERATING";
    if (j && j.stage === "READY") return "AWAITING_REVIEW";
  }
  if (s.recipeId || s.titleId) return "PLANNED";
  return "EMPTY";
}

export async function campaignView(id: string) {
  const c = await db.query.campaigns.findFirst({ where: eq(schema.campaigns.id, id) });
  if (!c) throw new PromoError("NOT_FOUND", `Campaign ${id} not found`);
  const slotRows = await db.query.slots.findMany({ where: eq(schema.slots.campaignId, id), orderBy: asc(schema.slots.date) });
  const titleIds = [...new Set(slotRows.map((s) => s.titleId).filter((x): x is string => !!x))];
  const titles = titleIds.length ? await db.query.titles.findMany({ where: inArray(schema.titles.id, titleIds) }) : [];
  const tmap = new Map(titles.map((t) => [t.id, t]));
  const jobIds = slotRows.map((s) => s.jobId).filter((x): x is string => !!x);
  const jobs = jobIds.length ? await db.query.jobs.findMany({ where: inArray(schema.jobs.id, jobIds) }) : [];
  const jmap = new Map(jobs.map((j) => [j.id, j]));

  const slots = [];
  let spend = 0;
  const counts: Record<SlotStatus, number> = { EMPTY: 0, PLANNED: 0, GENERATING: 0, AWAITING_REVIEW: 0, APPROVED: 0, SCHEDULED: 0, PUBLISHED: 0, MEASURED: 0 };
  for (const s of slotRows) {
    const status = await liveStatus(s);
    if (status !== s.status) await db.update(schema.slots).set({ status }).where(eq(schema.slots.id, s.id));
    counts[status]++;
    const j = s.jobId ? jmap.get(s.jobId) : undefined;
    if (j) spend += Number(j.costSpentInr);
    const t = s.titleId ? tmap.get(s.titleId) : undefined;
    slots.push({ ...rowToSlot({ ...s, status }), title: t ? { id: t.id, name: t.name, name_native: t.nameNative } : null, job_stage: j?.stage ?? null, cost_inr: j ? Number(j.costSpentInr) : 0 });
  }
  return { ...rowToCampaign(c), slots, counts, spend_inr: Math.round(spend * 100) / 100 };
}

export async function addSlots(campaignId: string, body: z.infer<typeof SlotCreateRequest>) {
  const req = SlotCreateRequest.parse(body);
  await campaignView(campaignId);
  for (const s of req.slots) await db.insert(schema.slots).values({ id: ids.slot(), campaignId, date: s.date, intendedFormat: s.intended_format, status: "EMPTY" });
  return campaignView(campaignId);
}

async function pickAngle(titleId: string, angleId: string | null) {
  const angles = await getAngles(titleId);
  if (angleId) {
    const a = angles.find((x) => x.id === angleId);
    if (!a) throw new PromoError("NOT_FOUND", `Angle ${angleId} not found on title ${titleId}`);
    return a;
  }
  const a = angles.find((x) => x.spoiler_safe && x.vertical_feasible) ?? angles.find((x) => x.spoiler_safe);
  if (!a) throw new PromoError("INSUFFICIENT_EVIDENCE", `Title ${titleId} has no spoiler-safe angle. Build intelligence first.`);
  return a;
}

/** Batch fill preview: combined cost shown before anything is enqueued (§10). */
export async function previewFill(campaignId: string, body: SlotFillRequest) {
  const req = SlotFillRequest.parse(body);
  const campaign = await campaignView(campaignId);
  const preset = await getPreset(req.preset_id);
  const items = [];
  let total = 0;
  const problems: string[] = [];
  for (const f of req.fills) {
    const slot = campaign.slots.find((s) => s.id === f.slot_id);
    if (!slot) {
      problems.push(`Slot ${f.slot_id} is not in this campaign.`);
      continue;
    }
    if (slot.status !== "EMPTY" && slot.status !== "PLANNED") {
      problems.push(`Slot ${slot.date} is ${slot.status}; only EMPTY or PLANNED slots can be filled.`);
      continue;
    }
    const title = await getTitle(f.title_id);
    if (title.dialect !== campaign.channel) problems.push(`${title.name} is ${title.dialect}; campaign channel is ${campaign.channel}.`);
    let angle;
    try {
      angle = await pickAngle(f.title_id, f.angle_id);
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
      continue;
    }
    const request = { title_id: f.title_id, angle_id: angle.id, format: slot.intended_format as FormatCode, dialect: campaign.channel as DialectCode, duration_s: preset.duration_s, ratios: preset.ratios, cta_variant: preset.cta_variant, music_brief: preset.music_brief, source_window: null, persona_id: null, created_by: req.created_by };
    const preview = await previewRecipe(request);
    problems.push(...preview.problems.map((p) => `${title.name}: ${p}`));
    total += preview.estimate.total;
    items.push({ slot_id: slot.id, date: slot.date, title: { id: title.id, name: title.name }, angle: { id: angle.id, claim: angle.claim }, request, estimate_inr: preview.estimate.total });
  }
  const over = campaign.spend_inr + total > campaign.budget_inr;
  if (over) problems.push(`Combined estimate ₹${total} would take the campaign to ₹${(campaign.spend_inr + total).toFixed(0)} against a ₹${campaign.budget_inr} budget.`);
  return { items, total_estimate_inr: Math.round(total * 100) / 100, ok: problems.length === 0, problems };
}

/** Batch fill: N slots, one preset, N titles → N recipes + N jobs in one click. */
export async function fillSlots(campaignId: string, body: SlotFillRequest) {
  const req = SlotFillRequest.parse(body);
  const preview = await previewFill(campaignId, req);
  if (!preview.ok) throw new PromoError("VALIDATION", preview.problems.join(" "), { detail: { problems: preview.problems }, recovery: "Fix the listed slots and confirm again. Nothing was charged." });
  if (req.confirm_cost_inr !== undefined && Math.abs(req.confirm_cost_inr - preview.total_estimate_inr) > 0.01)
    throw new PromoError("VALIDATION", `Estimate changed: you confirmed ₹${req.confirm_cost_inr}, current estimate is ₹${preview.total_estimate_inr}.`, { recovery: "Review the new estimate and confirm again." });
  const created = [];
  for (const item of preview.items) {
    const { recipe } = await createRecipe(item.request);
    const { jobId, promoId } = await createJob(recipe.id);
    await db.update(schema.slots).set({ titleId: item.title.id, recipeId: recipe.id, jobId, promoId, status: "GENERATING" }).where(eq(schema.slots.id, item.slot_id));
    created.push({ slot_id: item.slot_id, recipe_id: recipe.id, job_id: jobId, promo_id: promoId });
  }
  return { created, total_estimate_inr: preview.total_estimate_inr, campaign: await campaignView(campaignId) };
}

/** Attach an already-created job to a slot (used when a producer generates from the Title Workspace and then places it). */
export async function assignSlot(slotId: string, jobId: string) {
  const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new PromoError("NOT_FOUND", `Job ${jobId} not found`);
  const recipe = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, job.recipeId) });
  await db.update(schema.slots).set({ titleId: recipe?.titleId ?? null, recipeId: job.recipeId, jobId, promoId: job.promoId, status: "GENERATING" }).where(eq(schema.slots.id, slotId));
}
