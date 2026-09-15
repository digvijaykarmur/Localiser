import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { DialectCode, FormatCode, Ratio, ReasonCode, Verdict } from "@/domain";

/** PVL (§3.7, §29): one row per promo per ratio, written regardless of outcome. */
export async function writeLedgerRow(row: {
  promoId: string;
  ratio: Ratio;
  recipeId: string;
  titleId: string;
  format: FormatCode;
  dialect: DialectCode;
  costInr: number;
  costBreakdown: Record<string, number>;
  wallMs: number;
  qcDeterministic: Record<string, boolean>;
  qcAi: Record<string, number | boolean>;
}) {
  await db
    .insert(schema.ledger)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.ledger.promoId, schema.ledger.ratio],
      set: {
        costInr: row.costInr,
        costBreakdown: row.costBreakdown,
        wallMs: row.wallMs,
        qcDeterministic: row.qcDeterministic,
        qcAi: row.qcAi,
      },
    });
}

export async function recordVerdict(promoId: string, v: { verdict: Verdict; reason_codes: ReasonCode[]; edit_minutes: number | null; note: string | null }) {
  await db
    .update(schema.ledger)
    .set({ editorVerdict: v.verdict, editorReasonCodes: v.reason_codes, editorEditMinutes: v.edit_minutes, editorNote: v.note })
    .where(eq(schema.ledger.promoId, promoId));
}

export async function recordOutcome(promoId: string, o: { published_at: Date | null; impressions: number; view_rate_3s: number; completion_rate: number; ctr_to_title: number }) {
  const r = await db
    .update(schema.ledger)
    // Analytics rows without a published_at must not erase the timestamp recorded at manual publish.
    .set({ ...(o.published_at ? { publishedAt: o.published_at } : {}), impressions: o.impressions, viewRate3s: o.view_rate_3s, completionRate: o.completion_rate, ctrToTitle: o.ctr_to_title })
    .where(eq(schema.ledger.promoId, promoId))
    .returning({ promoId: schema.ledger.promoId });
  return r.length;
}

export async function ledgerRowsFor(promoId: string, ratio?: Ratio) {
  return db.query.ledger.findMany({ where: ratio ? and(eq(schema.ledger.promoId, promoId), eq(schema.ledger.ratio, ratio)) : eq(schema.ledger.promoId, promoId) });
}
