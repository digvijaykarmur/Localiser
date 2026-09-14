import { z } from "zod";
import { jsonOk, jsonError, readJson } from "@/lib/http";
import { OutcomeRow } from "@/domain";
import { db } from "@/db/client";
import { outcomes, ledger } from "@/db/schema";
import { LedgerRow } from "@/domain";
import { eq } from "drizzle-orm";

const Body = z.object({ rows: z.array(OutcomeRow) });
const Envelope = z.object({ upserted: z.number() });

export async function POST(req: Request) {
  try {
    const body = await readJson(req, Body);
    for (const row of body.rows) {
      await db
        .insert(outcomes)
        .values({
          promoId: row.promo_id,
          impressions: row.impressions,
          view3s: row.view_3s,
          viewsComplete: row.views_complete,
          clicks: row.clicks,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: outcomes.promoId,
          set: {
            impressions: row.impressions,
            view3s: row.view_3s,
            viewsComplete: row.views_complete,
            clicks: row.clicks,
            syncedAt: new Date(),
          },
        });
      const led = (await db.select().from(ledger).where(eq(ledger.promoId, row.promo_id)))[0];
      if (led) {
        const payload = LedgerRow.parse(led.payload);
        const next = LedgerRow.parse({
          ...payload,
          impressions: row.impressions,
          view_rate_3s: row.view_3s,
          completion_rate: row.views_complete,
          ctr_to_title: row.impressions ? row.clicks / row.impressions : null,
        });
        await db.update(ledger).set({ payload: next }).where(eq(ledger.promoId, row.promo_id));
      }
    }
    return jsonOk(Envelope, { upserted: body.rows.length });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
