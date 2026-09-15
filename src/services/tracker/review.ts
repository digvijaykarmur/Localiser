import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { PromoError, ReviewRequest } from "@/domain";
import { recordVerdict } from "../ledger";

/**
 * J3 — record the editor's verdict (§8). One call, no confirmation. The promo status moves to
 * APPROVED or REJECTED (minor/major edit count as approved-with-work for the delivery gate only
 * once the editor has done the work; they stay AWAITING_REVIEW until re-reviewed as approved).
 */
export async function reviewPromo(promoId: string, body: ReviewRequest) {
  const req = ReviewRequest.parse(body);
  const promo = await db.query.promos.findFirst({ where: eq(schema.promos.id, promoId) });
  if (!promo) throw new PromoError("NOT_FOUND", `Promo ${promoId} not found. Only jobs that passed QC produce a promo.`);
  if (["SCHEDULED", "PUBLISHED", "MEASURED"].includes(promo.status))
    throw new PromoError("INVALID_TRANSITION", `Promo ${promoId} is ${promo.status}; verdicts are final after scheduling.`);

  const status = req.verdict === "approved" ? "APPROVED" : req.verdict === "rejected" ? "REJECTED" : "AWAITING_REVIEW";
  await db
    .update(schema.promos)
    .set({ status, verdict: req.verdict, reasonCodes: req.reason_codes, editMinutes: req.edit_minutes, note: req.note, reviewer: req.reviewer, reviewedAt: new Date() })
    .where(eq(schema.promos.id, promoId));
  await recordVerdict(promoId, { verdict: req.verdict, reason_codes: req.reason_codes, edit_minutes: req.edit_minutes, note: req.note });
  await db.update(schema.slots).set({ status: status === "APPROVED" ? "APPROVED" : "AWAITING_REVIEW" }).where(eq(schema.slots.promoId, promoId));

  const next = await nextInQueue(promoId);
  return { promo_id: promoId, status, verdict: req.verdict, next_promo_id: next?.promo_id ?? null, next_job_id: next?.job_id ?? null };
}

/** Review queue: promos awaiting a verdict, oldest first, so `Enter` advances predictably. */
export async function reviewQueue() {
  const rows = await db.query.promos.findMany({ where: eq(schema.promos.status, "AWAITING_REVIEW"), orderBy: desc(schema.promos.createdAt) });
  const recipeIds = [...new Set(rows.map((r) => r.recipeId))];
  const recipes = recipeIds.length ? await db.query.recipes.findMany({ where: inArray(schema.recipes.id, recipeIds) }) : [];
  const titleIds = [...new Set(rows.map((r) => r.titleId))];
  const titles = titleIds.length ? await db.query.titles.findMany({ where: inArray(schema.titles.id, titleIds) }) : [];
  const rmap = new Map(recipes.map((r) => [r.id, r]));
  const tmap = new Map(titles.map((t) => [t.id, t]));
  return rows
    .reverse()
    .map((p) => {
      const r = rmap.get(p.recipeId);
      const t = tmap.get(p.titleId);
      return { promo_id: p.id, job_id: p.jobId, title: t ? { id: t.id, name: t.name, name_native: t.nameNative } : null, format: r?.format ?? null, dialect: r?.dialect ?? null, duration_s: r?.durationS ?? null, created_at: p.createdAt.toISOString() };
    });
}

async function nextInQueue(afterPromoId: string) {
  const q = await reviewQueue();
  const i = q.findIndex((x) => x.promo_id === afterPromoId);
  return q[i + 1] ?? q.find((x) => x.promo_id !== afterPromoId) ?? null;
}
