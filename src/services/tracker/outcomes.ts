import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { OutcomeRow } from "@/domain";
import { log } from "@/lib/log";
import { clickhouse } from "@/providers";
import { recordOutcome } from "../ledger";

const logger = log("outcomes");

export interface OutcomeSyncResult {
  received: number;
  matched: number;
  unmatched: string[];
}

/** Apply performance rows to the ledger, joining on promo_id (§32.2). Unmatched ids are reported, not dropped silently. */
export async function ingestOutcomes(rowsIn: OutcomeRow[]): Promise<OutcomeSyncResult> {
  const rows = rowsIn.map((r) => OutcomeRow.parse(r));
  const unmatched: string[] = [];
  let matched = 0;
  const ids = rows.map((r) => r.promo_id);
  const known = ids.length ? await db.query.promos.findMany({ where: inArray(schema.promos.id, ids) }) : [];
  const knownIds = new Set(known.map((p) => p.id));

  for (const r of rows) {
    if (!knownIds.has(r.promo_id)) {
      unmatched.push(r.promo_id);
      continue;
    }
    const impressions = r.impressions;
    const publishedAt = r.published_at ? new Date(r.published_at) : null;
    const n = await recordOutcome(r.promo_id, {
      published_at: publishedAt,
      impressions,
      view_rate_3s: impressions ? r.view_3s / impressions : 0,
      completion_rate: impressions ? r.views_complete / impressions : 0,
      ctr_to_title: impressions ? r.clicks / impressions : 0,
    });
    if (n > 0) {
      matched++;
      await db
        .update(schema.promos)
        .set({ status: "MEASURED", publishedAt: publishedAt ?? undefined })
        .where(eq(schema.promos.id, r.promo_id));
      await db.update(schema.slots).set({ status: "MEASURED" }).where(eq(schema.slots.promoId, r.promo_id));
    } else unmatched.push(r.promo_id);
  }
  logger.info("outcomes ingested", { received: rows.length, matched, unmatched: unmatched.length });
  return { received: rows.length, matched, unmatched };
}

/** Daily sync: pull analytics.promo_performance and join on promo_id. */
export async function syncOutcomes(sinceDays = 30): Promise<OutcomeSyncResult> {
  const ch = await clickhouse();
  const perf = await ch.getPromoPerformance(sinceDays);
  return ingestOutcomes(perf.map((p) => ({ promo_id: p.promo_id, published_at: p.published_at ?? null, impressions: p.impressions, view_3s: p.view_3s, views_complete: p.views_complete, clicks: p.clicks })));
}
