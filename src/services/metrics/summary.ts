import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { median, spearman, VERDICT_ORDINAL, type DialectCode, type FormatCode, type PPPTier, type ReasonCode, type Verdict } from "@/domain";
import { statsFromRows } from "./ppp";

export interface PairSummary {
  format: FormatCode;
  dialect: DialectCode;
  /** 1. promos produced */
  promos: number;
  reviewed: number;
  /** 2. editor approval rate (0..1 over reviewed) */
  approval_rate: number;
  /** 3. median edit-minutes — the definition of done */
  median_edit_minutes: number | null;
  /** 4. median cost per approved promo */
  median_cost_approved_inr: number | null;
  /** 5. reason-code histogram, top 5 */
  reason_codes: { code: ReasonCode; count: number }[];
  tier: PPPTier;
}

export interface MetricsSummary {
  pairs: PairSummary[];
  judge_editor_correlation: { spearman: number | null; n: number; calibrated: boolean };
  baseline_edit_minutes: number | null;
  totals: { promos: number; reviewed: number; approved: number; spend_inr: number };
  computed_at: string;
}

/** The five numbers per (format, dialect), nothing else (§32.3). */
export async function metricsSummary(baselineEditMinutes: number | null = null): Promise<MetricsSummary> {
  const rows = await db.query.ledger.findMany({ orderBy: desc(schema.ledger.createdAt) });
  const groups = new Map<string, (typeof schema.ledger.$inferSelect)[]>();
  for (const r of rows) {
    const k = `${r.format}|${r.dialect}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  const pairs: PairSummary[] = [];
  for (const [k, g] of groups) {
    const [format, dialect] = k.split("|") as [FormatCode, DialectCode];
    const s = statsFromRows(format, dialect, g);
    const byPromo = new Map<string, typeof schema.ledger.$inferSelect>();
    for (const r of g) if (!byPromo.has(r.promoId)) byPromo.set(r.promoId, r);
    const promos = [...byPromo.values()];
    const approvedCosts = promos.filter((r) => r.editorVerdict === "approved").map((r) => r.costInr);
    const hist = new Map<ReasonCode, number>();
    for (const r of promos) for (const c of r.editorReasonCodes as ReasonCode[]) hist.set(c, (hist.get(c) ?? 0) + 1);
    const top = [...hist.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 5);
    pairs.push({ format, dialect, promos: s.promos, reviewed: s.reviewed, approval_rate: s.approval_rate, median_edit_minutes: s.median_edit_minutes, median_cost_approved_inr: median(approvedCosts), reason_codes: top, tier: s.tier });
  }
  pairs.sort((a, b) => a.dialect.localeCompare(b.dialect) || a.format.localeCompare(b.format));

  // Judge-vs-editor correlation (§31.3): A8 against verdict ordinal, one pair per reviewed promo.
  const a8: number[] = [];
  const verdicts: number[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.editorVerdict || seen.has(r.promoId)) continue;
    const score = r.qcAi.A8;
    if (typeof score !== "number") continue;
    seen.add(r.promoId);
    a8.push(score);
    verdicts.push(VERDICT_ORDINAL[r.editorVerdict as Verdict]);
  }
  const rho = spearman(a8, verdicts);

  const promoRows = new Map<string, typeof schema.ledger.$inferSelect>();
  for (const r of rows) if (!promoRows.has(r.promoId)) promoRows.set(r.promoId, r);
  const all = [...promoRows.values()];
  const reviewedAll = all.filter((r) => r.editorVerdict);

  return {
    pairs,
    judge_editor_correlation: { spearman: rho, n: a8.length, calibrated: rho !== null && rho >= 0.5 && a8.length >= 50 },
    baseline_edit_minutes: baselineEditMinutes,
    totals: { promos: all.length, reviewed: reviewedAll.length, approved: reviewedAll.filter((r) => r.editorVerdict === "approved").length, spend_inr: Math.round(all.reduce((s, r) => s + r.costInr, 0) * 100) / 100 },
    computed_at: new Date().toISOString(),
  };
}
